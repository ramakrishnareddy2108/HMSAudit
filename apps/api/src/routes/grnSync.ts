import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'
import { excelService } from '../services/excelService'

const syncRunIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const conflictParamsSchema = z.object({
  id: z.string().uuid(),
  conflictId: z.string().uuid(),
})

const resolveConflictBodySchema = z.object({
  resolution: z.enum(['keep_system', 'use_excel']),
  adminNote: z.string().min(1, 'Admin note is required'),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const ALLOWED_EXCEL_EXTENSIONS = ['.xlsx', '.xls']

export default async function grnSyncRoutes(fastify: FastifyInstance) {
  // POST /grn-sync/upload
  fastify.post(
    '/upload',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as User).id
      let fileBuffer: Buffer | null = null
      let originalFilename = ''

      try {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            originalFilename = (part.filename ?? '').toLowerCase()
            if (!ALLOWED_EXCEL_EXTENSIONS.some((ext) => originalFilename.endsWith(ext))) {
              return reply.code(400).send({ error: 'Only .xlsx and .xls files are accepted' })
            }
            fileBuffer = await part.toBuffer()
          }
        }
      } catch {
        return reply.code(400).send({ error: 'Failed to parse multipart request' })
      }

      if (!fileBuffer) return reply.code(400).send({ error: 'Excel file is required' })

      let rows: ReturnType<typeof excelService.parseGrnExcel>
      try {
        rows = excelService.parseGrnExcel(fileBuffer)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to parse Excel file'
        return reply.code(400).send({ error: msg })
      }

      const ext = originalFilename.endsWith('.xls') && !originalFilename.endsWith('.xlsx')
        ? '.xls'
        : '.xlsx'
      const storagePath = `grn-excel/${userId}/${Date.now()}${ext}`
      const contentType =
        ext === '.xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.ms-excel'

      const { error: uploadError } = await fastify.supabase.storage
        .from('invoices')
        .upload(storagePath, fileBuffer, { contentType, upsert: false })

      if (uploadError) {
        return reply.code(500).send({ error: 'File upload failed: ' + uploadError.message })
      }

      const { data: signedData } = await fastify.supabase.storage
        .from('invoices')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

      const fileUrl = signedData?.signedUrl ?? null

      const syncRun = await fastify.prisma.grnSyncRun.create({
        data: {
          runBy: userId,
          fileUrl,
          totalRows: rows.length,
          status: 'processing',
        },
      })

      let inserted = 0
      let skipped = 0
      let conflicts = 0

      for (const row of rows) {
        if (!row.vendorName) {
          fastify.log.warn({ grnNumber: row.grnNumber }, 'GRN row missing vendor name, skipping')
          continue
        }

        const vendor = await fastify.prisma.vendor.findFirst({
          where: {
            name: { equals: row.vendorName, mode: 'insensitive' },
            isActive: true,
            deletedAt: null,
          },
        })

        if (!vendor) {
          fastify.log.warn(
            { grnNumber: row.grnNumber, vendorName: row.vendorName },
            'Vendor not found, skipping GRN row',
          )
          continue
        }

        try {
          const outcome = await fastify.prisma.$transaction(async (tx) => {
            const existing = await tx.grnMaster.findFirst({
              where: { grnNumber: row.grnNumber },
            })

            if (!existing) {
              await tx.grnMaster.create({
                data: {
                  vendorId: vendor.id,
                  invoiceNumber: row.invoiceNumber,
                  grnNumber: row.grnNumber,
                  grnAmount: row.grnAmount,
                  grnDate: row.grnDate ? new Date(row.grnDate) : null,
                  syncRunId: syncRun.id,
                },
              })
              return 'inserted' as const
            }

            const diff = Math.abs(Number(existing.grnAmount) - row.grnAmount)
            if (diff <= 0.01) return 'skipped' as const

            await tx.grnConflict.create({
              data: {
                syncRunId: syncRun.id,
                grnNumber: row.grnNumber,
                systemAmount: Number(existing.grnAmount),
                excelAmount: row.grnAmount,
              },
            })
            return 'conflict' as const
          })

          if (outcome === 'inserted') inserted++
          else if (outcome === 'skipped') skipped++
          else conflicts++
        } catch (err) {
          fastify.log.error({ err, grnNumber: row.grnNumber }, 'Failed to process GRN row')
        }
      }

      const finalStatus = conflicts > 0 ? 'has_conflicts' : 'completed'

      await fastify.prisma.grnSyncRun.update({
        where: { id: syncRun.id },
        data: { inserted, skipped, conflicts, status: finalStatus },
      })

      return { syncRunId: syncRun.id, inserted, skipped, conflicts, status: finalStatus }
    },
  )

  // GET /grn-sync/runs
  fastify.get(
    '/runs',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { page, limit } = listQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const [runs, total] = await Promise.all([
        fastify.prisma.grnSyncRun.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            runner: { select: { id: true, name: true, email: true } },
          },
        }),
        fastify.prisma.grnSyncRun.count(),
      ])

      return {
        data: runs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      }
    },
  )

  // GET /grn-sync/runs/:id/conflicts
  fastify.get(
    '/runs/:id/conflicts',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = syncRunIdParamsSchema.parse(request.params)

      const syncRun = await fastify.prisma.grnSyncRun.findUnique({ where: { id } })
      if (!syncRun) return reply.code(404).send({ error: 'Sync run not found' })

      const [unresolvedConflicts, totalCount, resolvedCount] = await Promise.all([
        fastify.prisma.grnConflict.findMany({
          where: { syncRunId: id, resolution: null },
          orderBy: { createdAt: 'asc' },
        }),
        fastify.prisma.grnConflict.count({ where: { syncRunId: id } }),
        fastify.prisma.grnConflict.count({ where: { syncRunId: id, resolution: { not: null } } }),
      ])

      return { syncRunId: id, conflicts: unresolvedConflicts, resolvedCount, totalCount }
    },
  )

  // POST /grn-sync/runs/:id/conflicts/:conflictId/resolve
  fastify.post(
    '/runs/:id/conflicts/:conflictId/resolve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, conflictId } = conflictParamsSchema.parse(request.params)
      const { resolution, adminNote } = resolveConflictBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const conflict = await fastify.prisma.grnConflict.findUnique({ where: { id: conflictId } })
      if (!conflict) return reply.code(404).send({ error: 'Conflict not found' })
      if (conflict.syncRunId !== id) {
        return reply.code(404).send({ error: 'Conflict not found in this sync run' })
      }
      if (conflict.resolution !== null) {
        return reply.code(409).send({ error: 'Conflict already resolved' })
      }

      await fastify.prisma.$transaction(async (tx) => {
        if (resolution === 'use_excel') {
          await tx.grnMaster.updateMany({
            where: { grnNumber: conflict.grnNumber },
            data: { grnAmount: conflict.excelAmount },
          })
        }

        await tx.grnConflict.update({
          where: { id: conflictId },
          data: { resolvedBy: userId, resolution, adminNote, resolvedAt: new Date() },
        })

        const unresolvedCount = await tx.grnConflict.count({
          where: { syncRunId: id, resolution: null },
        })

        if (unresolvedCount === 0) {
          await tx.grnSyncRun.update({ where: { id }, data: { status: 'completed' } })
        }
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'grn_conflict_resolved',
          entityType: 'grn_conflict',
          entityId: conflictId,
          newValue: { resolution, adminNote, syncRunId: id, grnNumber: conflict.grnNumber },
          ipAddress: request.ip,
        },
      })

      return { success: true, resolution }
    },
  )
}
