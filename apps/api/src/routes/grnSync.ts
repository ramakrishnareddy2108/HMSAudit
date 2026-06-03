import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma, User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'
import { excelService } from '../services/excelService'
import { storageService } from '../services/storageService'
import { AUDIT_LOG_ENABLED } from '../constants'

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

const searchQuerySchema = z.object({
  vendorId: z.string().uuid().optional(),
  search: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
})

const ALLOWED_EXCEL_EXTENSIONS = ['.xlsx', '.xls']

export default async function grnSyncRoutes(fastify: FastifyInstance) {
  // POST /grn-sync/upload
  fastify.post(
    '/upload',
    {
      schema: { tags: ['GRN Sync'], summary: 'Upload GRN Excel file' },
      preHandler: [authenticate, requireRole('admin')],
    },
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

      let parsedRows: ReturnType<typeof excelService.parseGrnExcel>
      try {
        parsedRows = excelService.parseGrnExcel(fileBuffer)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to parse Excel file'
        return reply.code(400).send({ error: msg })
      }

      const ext = originalFilename.endsWith('.xls') && !originalFilename.endsWith('.xlsx')
        ? '.xls'
        : '.xlsx'
      const contentType =
        ext === '.xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.ms-excel'

      let fileUrl: string | null = null
      try {
        const result = await storageService.uploadFile({
          buffer: fileBuffer,
          filename: `grn${ext}`,
          mimetype: contentType,
          folder: `grn-excel/${userId}`,
        })
        fileUrl = result.path
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File upload failed'
        return reply.code(500).send({ error: msg })
      }

      const syncRun = await fastify.prisma.grnSyncRun.create({
        data: {
          runBy: userId,
          fileUrl,
          totalRows: parsedRows.length,
          status: 'processing',
        } as unknown as Prisma.GrnSyncRunUncheckedCreateInput,
      })

      let inserted = 0
      let skipped = 0
      let conflicts = 0

      for (const { mapped: row, raw } of parsedRows) {
        if (!row.vendorName) {
          fastify.log.warn({ grnNumber: row.grnNumber }, 'GRN row missing vendor name, skipping')
          continue
        }

        const vendor = await fastify.prisma.vendor.findFirst({
          where: {
            name: { equals: row.vendorName, mode: 'insensitive' },
            isActive: true,
            isDeleted: false,
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
                  rawExcelData: raw,
                } as unknown as Prisma.GrnMasterUncheckedCreateInput,
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
                rawExcelData: raw,
              } as unknown as Prisma.GrnConflictUncheckedCreateInput,
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
    {
      schema: { tags: ['GRN Sync'], summary: 'List GRN sync runs' },
      preHandler: [authenticate, requireRole('admin')],
    },
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

  // GET /grn-sync/search
  fastify.get(
    '/search',
    {
      schema: { tags: ['GRN Sync'], summary: 'Search GRN master records' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { vendorId, search, month, year, limit } = searchQuerySchema.parse(request.query)
      const hospitalId = (request.user as User & { activeHospitalId: string }).activeHospitalId

      const where: Prisma.GrnMasterWhereInput = { hospitalId }

      if (vendorId) where.vendorId = vendorId

      if (search && search.trim().length >= 2) {
        const term = search.trim()
        where.OR = [
          { grnNumber: { contains: term, mode: 'insensitive' } },
          { invoiceNumber: { contains: term, mode: 'insensitive' } },
          { grnAmount: { equals: isNaN(Number(term)) ? undefined : Number(term) } },
        ]
      }

      if (month && year) {
        const start = new Date(year, month - 1, 1)
        const end = new Date(year, month, 1)
        where.grnDate = { gte: start, lt: end }
      }

      const rows = await fastify.prisma.grnMaster.findMany({
        where,
        take: limit,
        orderBy: { grnDate: 'desc' },
        include: {
          vendor: { select: { id: true, name: true } },
        },
      })

      const grnNumbers = rows.map((r) => r.grnNumber)
      const matchedEntries = grnNumbers.length > 0
        ? await fastify.prisma.grnEntry.findMany({
            where: { grnNumber: { in: grnNumbers }, isDeleted: false },
            select: { grnNumber: true },
          })
        : []
      const matchedSet = new Set(matchedEntries.map((e) => e.grnNumber))

      const data = rows.map((row) => {
        const extra = (row.rawExcelData ?? {}) as Record<string, unknown>
        return {
          id: row.id,
          grnNumber: row.grnNumber,
          invoiceNumber: row.invoiceNumber,
          grnDate: row.grnDate,
          grnAmount: row.grnAmount,
          vendor: row.vendor ? { id: row.vendor.id, name: row.vendor.name } : null,
          poNumber: extra['PO Number'] ?? extra['po_number'] ?? extra['poNumber'] ?? null,
          dcNumber: extra['DC Number'] ?? extra['dc_number'] ?? extra['dcNumber'] ?? null,
          qtyOrdered: extra['Qty Ordered'] ?? extra['qty_ordered'] ?? extra['qtyOrdered'] ?? null,
          qtyReceived: extra['Qty Received'] ?? extra['qty_received'] ?? extra['qtyReceived'] ?? null,
          storesLocation: extra['Stores Location'] ?? extra['stores_location'] ?? extra['storesLocation'] ?? null,
          cashOrCredit: extra['Cash/Credit'] ?? extra['cash_or_credit'] ?? extra['cashOrCredit'] ?? null,
          isMatched: matchedSet.has(row.grnNumber),
        }
      })

      return { data, total: data.length }
    },
  )

  // GET /grn-sync/runs/:id/conflicts
  fastify.get(
    '/runs/:id/conflicts',
    {
      schema: { tags: ['GRN Sync'], summary: 'Get conflicts for sync run' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
    {
      schema: { tags: ['GRN Sync'], summary: 'Resolve GRN sync conflict' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
            data: {
              grnAmount: conflict.excelAmount,
              rawExcelData: conflict.rawExcelData ?? Prisma.JsonNull,
            },
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

      if (AUDIT_LOG_ENABLED) {
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
      }

      return { success: true, resolution }
    },
  )
}
