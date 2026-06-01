import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { ReconciliationService } from '../services/reconciliationService'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const runParamsSchema = z.object({
  id: z.string().uuid(),
})

const resultParamsSchema = z.object({
  id: z.string().uuid(),
  resultId: z.string().uuid(),
})

const startReconBodySchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
})

const resolveResultBodySchema = z.object({
  resolution: z.enum(['accepted_app', 'accepted_excel', 'disputed']),
  adminNote: z.string().min(1, 'Admin note is required'),
})

const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const resultsQuerySchema = z.object({
  matchStatus: z.enum(['matched', 'amount_diff', 'app_only', 'excel_only']).optional(),
  vendorId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

export default async function reconciliationRoutes(fastify: FastifyInstance) {
  const reconService = new ReconciliationService(fastify.prisma)

  fastify.post(
    '/run',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { month, year } = startReconBodySchema.parse(request.body)

      try {
        const result = await reconService.runReconciliation(month, year, uid(request))

        await request.server.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'RUN_RECONCILIATION',
            entityType: 'ReconciliationRun',
            entityId: result.runId,
            newValue: { month, year } as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })

        return reply.status(201).send(result)
      } catch (err) {
        const e = err as Error & { statusCode?: number; unresolvedConflicts?: number }
        return reply.status(e.statusCode ?? 500).send({
          error: e.message,
          ...(e.unresolvedConflicts !== undefined && { unresolvedConflicts: e.unresolvedConflicts }),
        })
      }
    },
  )

  fastify.get(
    '/runs',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { page, limit } = listRunsQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const [runs, total] = await Promise.all([
        request.server.prisma.reconciliationRun.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            runner: { select: { id: true, name: true } },
          },
        }),
        request.server.prisma.reconciliationRun.count(),
      ])

      return {
        data: runs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      }
    },
  )

  fastify.get(
    '/runs/:id/results',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = runParamsSchema.parse(request.params)
      const { matchStatus, vendorId, page, limit } = resultsQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const run = await request.server.prisma.reconciliationRun.findUnique({ where: { id } })
      if (!run) return reply.status(404).send({ error: 'Reconciliation run not found' })

      const where: Prisma.ReconResultWhereInput = { reconRunId: id }
      if (matchStatus) where.matchStatus = matchStatus
      if (vendorId) {
        where.OR = [
          { grnEntry: { invoice: { vendorId } } },
          { grnMaster: { vendorId } },
        ]
      }

      const [results, total, categoryCounts] = await Promise.all([
        request.server.prisma.reconResult.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'asc' },
          include: {
            grnEntry: {
              include: {
                invoice: {
                  select: {
                    id: true,
                    invoiceNumber: true,
                    invoiceAmount: true,
                    fileUrl: true,
                    vendor: { select: { id: true, name: true } },
                  },
                },
              },
            },
            grnMaster: {
              include: {
                vendor: { select: { id: true, name: true } },
              },
            },
            resolver: { select: { id: true, name: true } },
          },
        }),
        request.server.prisma.reconResult.count({ where }),
        request.server.prisma.reconResult.groupBy({
          by: ['matchStatus'],
          where: { reconRunId: id },
          _count: { _all: true },
        }),
      ])

      const counts = Object.fromEntries(
        categoryCounts.map((c) => [c.matchStatus, c._count._all]),
      ) as Record<string, number>

      return {
        data: results,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        counts: {
          matched: counts['matched'] ?? 0,
          amount_diff: counts['amount_diff'] ?? 0,
          app_only: counts['app_only'] ?? 0,
          excel_only: counts['excel_only'] ?? 0,
        },
      }
    },
  )

  fastify.post(
    '/runs/:id/results/:resultId/resolve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, resultId } = resultParamsSchema.parse(request.params)
      const { resolution, adminNote } = resolveResultBodySchema.parse(request.body)

      const result = await request.server.prisma.reconResult.findFirst({
        where: { id: resultId, reconRunId: id },
        include: { grnEntry: true },
      })

      if (!result) return reply.status(404).send({ error: 'Result not found' })
      if (result.resolution) {
        return reply.status(409).send({ error: 'Result already resolved' })
      }

      const newGrnStatus = resolution === 'disputed' ? 'disputed' : 'reconciled'

      await request.server.prisma.$transaction(async (tx) => {
        await tx.reconResult.update({
          where: { id: resultId },
          data: {
            resolution,
            resolvedBy: uid(request),
            adminNote,
            resolvedAt: new Date(),
          },
        })

        if (result.grnEntryId) {
          await tx.grnEntry.update({
            where: { id: result.grnEntryId },
            data: { status: newGrnStatus },
          })
        }

        await tx.auditLog.create({
          data: {
            userId: uid(request),
            action: 'RESOLVE_RECON_RESULT',
            entityType: 'ReconResult',
            entityId: resultId,
            oldValue: {
              matchStatus: result.matchStatus,
              resolution: null,
            } as Prisma.InputJsonValue,
            newValue: {
              resolution,
              adminNote,
              grnStatus: newGrnStatus,
            } as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      })

      return { success: true }
    },
  )

  fastify.post(
    '/runs/:id/complete',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = runParamsSchema.parse(request.params)

      const run = await request.server.prisma.reconciliationRun.findUnique({ where: { id } })
      if (!run) return reply.status(404).send({ error: 'Reconciliation run not found' })

      try {
        await reconService.completeRun(id, uid(request))
        return { success: true }
      } catch (err) {
        const e = err as Error & { statusCode?: number; unresolvedCount?: number }
        return reply.status(e.statusCode ?? 500).send({
          error: e.message,
          ...(e.unresolvedCount !== undefined && { unresolvedCount: e.unresolvedCount }),
        })
      }
    },
  )
}
