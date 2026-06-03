import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, Resolution, MatchStatus, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { ReconciliationService } from '../services/reconciliationService'
import { storageService } from '../services/storageService'
import { AUDIT_LOG_ENABLED } from '../constants'

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

const fixGrnParamsSchema = z.object({
  resultId: z.string().uuid(),
})

const startReconBodySchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  force: z.boolean().default(false),
})

const resolveResultBodySchema = z.object({
  resolution: z.enum([
    'accepted_app',
    'accepted_excel',
    'accepted_partial',
    'disputed',
    'not_required',
    'override_valid',
    'pending_upload',
    'sent_back',
  ]),
  adminNote: z.string().min(1, 'Admin note is required'),
  sentBack: z.boolean().optional(),
})

const fixGrnBodySchema = z.object({
  newGrnNumber: z.string().min(1, 'GRN number is required'),
})

const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const resultsQuerySchema = z.object({
  matchStatus: z.enum(['matched', 'amount_diff', 'grn_not_found', 'invoice_only', 'excel_only']).optional(),
  vendorId: z.string().uuid().optional(),
  needsAction: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

export default async function reconciliationRoutes(fastify: FastifyInstance) {
  const reconService = new ReconciliationService(fastify.prisma)

  fastify.post(
    '/run',
    {
      schema: { tags: ['Reconciliation'], summary: 'Start reconciliation run' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { month, year, force } = startReconBodySchema.parse(request.body)

      try {
        const result = await reconService.runReconciliation(
          month,
          year,
          uid(request),
          request.user.activeHospitalId!,
          force,
        )

        if (AUDIT_LOG_ENABLED) {
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
        }

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
    {
      schema: { tags: ['Reconciliation'], summary: 'List reconciliation runs' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
    {
      schema: { tags: ['Reconciliation'], summary: 'Get reconciliation results' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = runParamsSchema.parse(request.params)
      const { matchStatus, vendorId, needsAction, page, limit } = resultsQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const run = await request.server.prisma.reconciliationRun.findUnique({ where: { id } })
      if (!run) return reply.status(404).send({ error: 'Reconciliation run not found' })

      const where: Prisma.ReconResultWhereInput = { reconRunId: id }
      if (needsAction === 'true') {
        where.matchStatus = { not: MatchStatus.matched }
        where.resolution = null
      } else {
        if (matchStatus) where.matchStatus = matchStatus
        if (vendorId) {
          where.OR = [
            { grnEntry: { invoice: { vendorId } } },
            { grnMaster: { vendorId } },
          ]
        }
      }

      const [results, total, categoryCounts, excelOnlyStatsResult, needsActionCount, resolvedCount] =
        await Promise.all([
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
                      invoiceDate: true,
                      invoiceAmount: true,
                      fileUrl: true,
                      createdAt: true,
                      vendor: { select: { id: true, name: true } },
                      uploader: { select: { id: true, name: true } },
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
          matchStatus === 'excel_only' || needsAction === 'true'
            ? request.server.prisma.reconResult.aggregate({
                where: { reconRunId: id, matchStatus: 'excel_only' },
                _count: { _all: true },
                _sum: { excelAmount: true },
              })
            : Promise.resolve(null),
          request.server.prisma.reconResult.count({
            where: { reconRunId: id, matchStatus: { not: MatchStatus.matched }, resolution: null },
          }),
          request.server.prisma.reconResult.count({
            where: { reconRunId: id, matchStatus: { not: MatchStatus.matched }, resolution: { not: null } },
          }),
        ])

      const counts = Object.fromEntries(
        categoryCounts.map((c) => [c.matchStatus, c._count._all]),
      ) as Record<string, number>

      const resultsWithUrls = await Promise.all(
        results.map(async (r) => {
          if (!r.grnEntry?.invoice.fileUrl) return r
          const presignedUrl = await storageService.getPresignedUrl(r.grnEntry.invoice.fileUrl)
          return {
            ...r,
            grnEntry: {
              ...r.grnEntry,
              invoice: { ...r.grnEntry.invoice, fileUrl: presignedUrl },
            },
          }
        }),
      )

      const amountDiff = counts['amount_diff'] ?? 0
      const grnNotFound = counts['grn_not_found'] ?? 0
      const invoiceOnly = counts['invoice_only'] ?? 0
      const excelOnly = counts['excel_only'] ?? 0

      return {
        data: resultsWithUrls,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        counts: {
          matched: counts['matched'] ?? 0,
          amount_diff: amountDiff,
          grn_not_found: grnNotFound,
          invoice_only: invoiceOnly,
          excel_only: excelOnly,
          needs_action: needsActionCount,
          resolved: resolvedCount,
          total_non_matched: amountDiff + grnNotFound + invoiceOnly + excelOnly,
        },
        ...(excelOnlyStatsResult
          ? {
              excelOnlyStats: {
                totalCount: excelOnlyStatsResult._count._all,
                totalAmount: excelOnlyStatsResult._sum.excelAmount?.toString() ?? '0',
              },
            }
          : {}),
      }
    },
  )

  fastify.post(
    '/runs/:id/results/:resultId/resolve',
    {
      schema: { tags: ['Reconciliation'], summary: 'Resolve reconciliation result' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, resultId } = resultParamsSchema.parse(request.params)
      const { resolution, adminNote } = resolveResultBodySchema.parse(request.body)

      try {
        await reconService.resolveResult(
          id,
          resultId,
          resolution as Resolution,
          adminNote,
          uid(request),
          request.user.activeHospitalId!,
        )

        if (AUDIT_LOG_ENABLED) {
          await request.server.prisma.auditLog.create({
            data: {
              userId: uid(request),
              action: 'RESOLVE_RECON_RESULT',
              entityType: 'ReconResult',
              entityId: resultId,
              newValue: { resolution, adminNote } as Prisma.InputJsonValue,
              ipAddress: request.ip,
            },
          })
        }

        return { success: true }
      } catch (err) {
        const e = err as Error & { statusCode?: number }
        return reply.status(e.statusCode ?? 500).send({ error: e.message })
      }
    },
  )

  fastify.post(
    '/results/:resultId/fix-grn',
    {
      schema: { tags: ['Reconciliation'], summary: 'Fix GRN number and re-run match' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { resultId } = fixGrnParamsSchema.parse(request.params)
      const { newGrnNumber } = fixGrnBodySchema.parse(request.body)

      try {
        const updated = await reconService.fixGrnNumber(
          resultId,
          newGrnNumber,
          request.user.activeHospitalId!,
        )
        return updated
      } catch (err) {
        const e = err as Error & { statusCode?: number }
        return reply.status(e.statusCode ?? 500).send({ error: e.message })
      }
    },
  )

  fastify.post(
    '/runs/:id/complete',
    {
      schema: { tags: ['Reconciliation'], summary: 'Complete reconciliation run' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = runParamsSchema.parse(request.params)

      const run = await request.server.prisma.reconciliationRun.findUnique({ where: { id } })
      if (!run) return reply.status(404).send({ error: 'Reconciliation run not found' })

      try {
        await reconService.completeRun(id, uid(request), request.user.activeHospitalId!)
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
