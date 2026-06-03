import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { storageService } from '../services/storageService'

interface DbTableStat {
  tablename: string
  size: string
  size_bytes: bigint
}

const hospitalIdParamsSchema = z.object({ id: z.string().uuid() })

const createHospitalBodySchema = z.object({
  name: z.string().min(1).max(200),
})

const updateHospitalBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
})

const createAdminBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
})

export default async function superAdminRoutes(fastify: FastifyInstance) {
  // GET /super/hospitals — list all hospitals with stats
  fastify.get(
    '/hospitals',
    { schema: { tags: ['Super Admin'], summary: 'List all hospitals with stats' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const hospitals = await request.server.prisma.hospital.findMany({
        orderBy: { name: 'asc' },
      })

      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      const withStats = await Promise.all(
        hospitals.map(async (h) => {
          const [adminCount, userCount, vendorCount, invoiceCountThisMonth] = await Promise.all([
            request.server.prisma.user.count({
              where: { hospitalId: h.id, role: 'admin', isActive: true },
            }),
            request.server.prisma.user.count({
              where: { hospitalId: h.id, isActive: true },
            }),
            request.server.prisma.vendor.count({
              where: { hospitalId: h.id, isDeleted: false },
            }),
            request.server.prisma.invoice.count({
              where: { hospitalId: h.id, createdAt: { gte: startOfMonth } },
            }),
          ])

          return { ...h, adminCount, userCount, vendorCount, invoiceCountThisMonth }
        }),
      )

      return withStats
    },
  )

  // POST /super/hospitals — create hospital
  fastify.post(
    '/hospitals',
    { schema: { tags: ['Super Admin'], summary: 'Create a new hospital' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createHospitalBodySchema.parse(request.body)

      const existing = await request.server.prisma.hospital.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' } },
      })
      if (existing) {
        return reply.code(409).send({ error: 'Hospital with this name already exists' })
      }

      const hospital = await request.server.prisma.hospital.create({ data: body })

      return reply.code(201).send(hospital)
    },
  )

  // PUT /super/hospitals/:id — update hospital
  fastify.put(
    '/hospitals/:id',
    { schema: { tags: ['Super Admin'], summary: 'Update hospital details' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = hospitalIdParamsSchema.parse(request.params)
      const body = updateHospitalBodySchema.parse(request.body)

      const existing = await request.server.prisma.hospital.findUnique({ where: { id } })
      if (!existing) {
        return reply.code(404).send({ error: 'Hospital not found' })
      }

      if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await request.server.prisma.hospital.findFirst({
          where: { name: { equals: body.name, mode: 'insensitive' }, id: { not: id } },
        })
        if (duplicate) {
          return reply.code(409).send({ error: 'Hospital with this name already exists' })
        }
      }

      const updated = await request.server.prisma.hospital.update({
        where: { id },
        data: body,
      })

      return updated
    },
  )

  // POST /super/hospitals/:id/admin — create a hospital admin account
  fastify.post(
    '/hospitals/:id/admin',
    { schema: { tags: ['Super Admin'], summary: 'Create hospital admin account' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: hospitalId } = hospitalIdParamsSchema.parse(request.params)
      const body = createAdminBodySchema.parse(request.body)

      const hospital = await request.server.prisma.hospital.findUnique({
        where: { id: hospitalId },
      })
      if (!hospital) {
        return reply.code(404).send({ error: 'Hospital not found' })
      }

      const existingUser = await request.server.prisma.user.findUnique({
        where: { email: body.email },
      })
      if (existingUser) {
        return reply.code(409).send({ error: 'A user with this email already exists' })
      }

      const { data: authData, error: authError } = await request.server.supabase.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      })
      if (authError) {
        return reply.code(500).send({ error: authError.message })
      }

      const user = await request.server.prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          role: 'admin',
          isSuperAdmin: false,
          hospitalId,
          isActive: true,
          supabaseId: authData.user?.id ?? undefined,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          hospitalId: true,
          isSuperAdmin: true,
          isActive: true,
          createdAt: true,
        },
      })

      return reply.code(201).send(user)
    },
  )

  // GET /super/hospitals/:id/users — list all users for a hospital
  fastify.get(
    '/hospitals/:id/users',
    { schema: { tags: ['Super Admin'], summary: 'List hospital users' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: hospitalId } = hospitalIdParamsSchema.parse(request.params)

      const hospital = await request.server.prisma.hospital.findUnique({
        where: { id: hospitalId },
      })
      if (!hospital) {
        return reply.code(404).send({ error: 'Hospital not found' })
      }

      const users = await request.server.prisma.user.findMany({
        where: { hospitalId, isSuperAdmin: false },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          departments: {
            select: {
              department: { select: { id: true, name: true } },
            },
          },
        },
      })

      return users
    },
  )

  // GET /super/monthly-status — monthly overview for all active hospitals
  fastify.get(
    '/monthly-status',
    { schema: { tags: ['Super Admin'], summary: 'Get monthly status overview' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const now = new Date()
      const periodMonth = now.getMonth() + 1
      const periodYear = now.getFullYear()
      const startOfMonth = new Date(Date.UTC(periodYear, periodMonth - 1, 1))
      const endOfMonth = new Date(Date.UTC(periodYear, periodMonth, 1))

      const hospitals = await request.server.prisma.hospital.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      })

      const hospitalResults = await Promise.all(
        hospitals.map(async (h) => {
          const [
            latestGrnSync,
            unresolvedConflicts,
            reconRun,
            pendingReviewCount,
            sentBackCount,
            totalOutstandingResult,
            totalVendors,
            totalUsers,
          ] = await Promise.all([
            request.server.prisma.grnSyncRun.findFirst({
              where: {
                hospitalId: h.id,
                createdAt: { gte: startOfMonth, lt: endOfMonth },
                status: { in: ['completed', 'has_conflicts'] },
              },
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true },
            }),
            request.server.prisma.grnConflict.count({
              where: { hospitalId: h.id, resolution: null },
            }),
            request.server.prisma.reconciliationRun.findFirst({
              where: {
                hospitalId: h.id,
                periodMonth,
                periodYear,
                status: 'completed',
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            }),
            request.server.prisma.invoice.count({
              where: {
                hospitalId: h.id,
                status: { in: ['pending_review', 're_submitted'] },
                isDeleted: false,
              },
            }),
            request.server.prisma.invoice.count({
              where: { hospitalId: h.id, status: 'sent_back', isDeleted: false },
            }),
            request.server.prisma.grnEntry.aggregate({
              where: { hospitalId: h.id, status: 'reconciled', isDeleted: false },
              _sum: { grnAmount: true },
            }),
            request.server.prisma.vendor.count({
              where: { hospitalId: h.id, isDeleted: false, isActive: true },
            }),
            request.server.prisma.user.count({
              where: { hospitalId: h.id, isActive: true, isSuperAdmin: false },
            }),
          ])

          const grnUploaded = latestGrnSync !== null
          const grnUploadedDate = latestGrnSync?.createdAt ?? null
          const reconciliationDone = reconRun !== null
          const totalOutstanding = Number(totalOutstandingResult._sum.grnAmount ?? 0)

          let pendingPaymentAmount = 0
          if (reconRun) {
            const payResult = await request.server.prisma.grnEntry.aggregate({
              where: {
                hospitalId: h.id,
                status: 'reconciled',
                isDeleted: false,
                reconResults: { some: { reconRunId: reconRun.id } },
              },
              _sum: { grnAmount: true },
            })
            pendingPaymentAmount = Number(payResult._sum.grnAmount ?? 0)
          }

          let status: 'needs_grn' | 'needs_resolution' | 'needs_reconciliation' | 'has_pending_review' | 'ready_to_pay' | 'complete'
          if (!grnUploaded) {
            status = 'needs_grn'
          } else if (unresolvedConflicts > 0) {
            status = 'needs_resolution'
          } else if (!reconciliationDone) {
            status = 'needs_reconciliation'
          } else if (pendingReviewCount > 0) {
            status = 'has_pending_review'
          } else if (pendingPaymentAmount > 0) {
            status = 'ready_to_pay'
          } else {
            status = 'complete'
          }

          return {
            hospitalId: h.id,
            hospitalName: h.name,
            workStatus: {
              grnUploaded,
              grnUploadedDate,
              reconciliationDone,
              unresolvedConflicts,
              pendingPaymentAmount,
              pendingReviewCount,
              sentBackCount,
              status,
            },
            overall: {
              totalOutstanding,
              totalVendors,
              totalUsers,
            },
          }
        }),
      )

      const crossHospitalTotals = {
        totalPendingReview: hospitalResults.reduce((s, h) => s + h.workStatus.pendingReviewCount, 0),
        totalReadyToPay: hospitalResults.reduce((s, h) => s + h.workStatus.pendingPaymentAmount, 0),
        totalOutstanding: hospitalResults.reduce((s, h) => s + h.overall.totalOutstanding, 0),
        hospitalsNeedingAction: hospitalResults.filter((h) => h.workStatus.status !== 'complete').length,
      }

      return { hospitals: hospitalResults, crossHospitalTotals }
    },
  )

  // GET /super/db-stats
  fastify.get(
    '/db-stats',
    { schema: { tags: ['Super Admin'], summary: 'Get database size statistics' }, preHandler: [authenticate, requireSuperAdmin] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const tableStats = await request.server.prisma.$queryRaw<DbTableStat[]>`
        SELECT tablename,
          pg_size_pretty(pg_total_relation_size(
            quote_ident(schemaname)||'.'||quote_ident(tablename)
          )) as size,
          pg_total_relation_size(
            quote_ident(schemaname)||'.'||quote_ident(tablename)
          ) as size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY size_bytes DESC
      `

      const top5 = tableStats.slice(0, 5).map((t) => ({
        tablename: t.tablename,
        size: t.size,
        sizeBytes: Number(t.size_bytes),
      }))

      const totalBytes = tableStats.reduce((sum, t) => sum + Number(t.size_bytes), 0)

      const [invoiceCount, grnCount, notificationCount, paymentCount, storageStats] = await Promise.all([
        request.server.prisma.invoice.count(),
        request.server.prisma.grnEntry.count(),
        request.server.prisma.notification.count(),
        request.server.prisma.payment.count(),
        storageService.getStorageStats().catch(() => ({ totalSizeBytes: 0, fileCount: 0 })),
      ])

      return {
        top5Tables: top5,
        totalBytes,
        rowCounts: { invoices: invoiceCount, grnEntries: grnCount, notifications: notificationCount, payments: paymentCount },
        storage: {
          totalSizeBytes: storageStats.totalSizeBytes,
          fileCount: storageStats.fileCount,
        },
      }
    },
  )
}
