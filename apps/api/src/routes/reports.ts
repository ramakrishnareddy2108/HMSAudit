import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const vendorLedgerQuerySchema = z.object({
  vendorId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
})

const reconSummaryQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
})

const pendingInvoicesQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
})

const auditLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export default async function reportsRoutes(fastify: FastifyInstance) {
  // GET /reports/vendor-ledger
  fastify.get(
    '/vendor-ledger',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { vendorId, year } = vendorLedgerQuerySchema.parse(request.query)

      const startDate = new Date(`${year}-01-01T00:00:00.000Z`)
      const endDate = new Date(`${year + 1}-01-01T00:00:00.000Z`)

      const invoices = await fastify.prisma.invoice.findMany({
        where: { vendorId, createdAt: { gte: startDate, lt: endDate } },
        select: {
          invoiceNumber: true,
          invoiceAmount: true,
          createdAt: true,
          grnEntries: {
            select: {
              grnNumber: true,
              grnAmount: true,
              status: true,
              paymentGrns: {
                take: 1,
                select: {
                  payment: {
                    select: { transactionRef: true, paymentDate: true },
                  },
                },
              },
            },
          },
        },
      })

      type GrnBreakdownItem = {
        grnNumber: string
        invoiceNumber: string
        amount: number
        status: string
        paymentRef: string | null
        paymentDate: Date | null
      }

      type MonthRow = {
        month: number
        year: number
        invoiced: number
        reconciled: number
        paid: number
        pending: number
        grnBreakdown: GrnBreakdownItem[]
      }

      const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        year,
        invoiced: 0,
        reconciled: 0,
        paid: 0,
        pending: 0,
        grnBreakdown: [],
      }))

      for (const invoice of invoices) {
        const monthIdx = invoice.createdAt.getUTCMonth()
        const bucket = months[monthIdx]
        if (!bucket) continue

        bucket.invoiced += Number(invoice.invoiceAmount)

        for (const grn of invoice.grnEntries) {
          const amount = Number(grn.grnAmount)
          const payment = grn.paymentGrns[0]?.payment ?? null

          if (grn.status === 'reconciled' || grn.status === 'paid') {
            bucket.reconciled += amount
          }
          if (grn.status === 'paid') {
            bucket.paid += amount
          }

          bucket.grnBreakdown.push({
            grnNumber: grn.grnNumber,
            invoiceNumber: invoice.invoiceNumber,
            amount,
            status: grn.status,
            paymentRef: payment?.transactionRef ?? null,
            paymentDate: payment?.paymentDate ?? null,
          })
        }

        bucket.pending = bucket.invoiced - bucket.reconciled
      }

      return months
    },
  )

  // GET /reports/dashboard-stats
  fastify.get(
    '/dashboard-stats',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))

      const [
        totalInvoices,
        pendingReview,
        reconciledThisMonth,
        paidThisMonthAgg,
        recentActivity,
        monthlyUploaded,
        monthlyReconciled,
        monthlyPaid,
        vendorCurrentMonth,
      ] = await Promise.all([
        fastify.prisma.invoice.count(),
        fastify.prisma.invoice.count({
          where: { status: { in: ['pending_review', 're_submitted'] } },
        }),
        fastify.prisma.invoice.count({
          where: { status: 'reconciled', updatedAt: { gte: monthStart, lt: monthEnd } },
        }),
        fastify.prisma.payment.aggregate({
          where: { createdAt: { gte: monthStart, lt: monthEnd } },
          _sum: { totalAmount: true },
        }),
        fastify.prisma.auditLog.findMany({
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            action: true,
            entityType: true,
            createdAt: true,
            user: { select: { name: true } },
          },
        }),
        fastify.prisma.invoice.findMany({
          where: { createdAt: { gte: twelveMonthsAgo } },
          select: { createdAt: true },
        }),
        fastify.prisma.invoice.findMany({
          where: { status: 'reconciled', updatedAt: { gte: twelveMonthsAgo } },
          select: { updatedAt: true },
        }),
        fastify.prisma.invoice.findMany({
          where: { status: 'paid', updatedAt: { gte: twelveMonthsAgo } },
          select: { updatedAt: true },
        }),
        fastify.prisma.invoice.findMany({
          where: { createdAt: { gte: monthStart, lt: monthEnd } },
          select: {
            invoiceAmount: true,
            vendor: { select: { id: true, name: true } },
            grnEntries: { select: { grnAmount: true, status: true } },
          },
        }),
      ])

      type ChartRow = { month: number; year: number; uploaded: number; reconciled: number; paid: number }
      const chartMap = new Map<string, ChartRow>()

      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`
        chartMap.set(key, {
          month: d.getUTCMonth() + 1,
          year: d.getUTCFullYear(),
          uploaded: 0,
          reconciled: 0,
          paid: 0,
        })
      }

      for (const inv of monthlyUploaded) {
        const key = `${inv.createdAt.getUTCFullYear()}-${inv.createdAt.getUTCMonth() + 1}`
        const b = chartMap.get(key)
        if (b) b.uploaded++
      }
      for (const inv of monthlyReconciled) {
        const key = `${inv.updatedAt.getUTCFullYear()}-${inv.updatedAt.getUTCMonth() + 1}`
        const b = chartMap.get(key)
        if (b) b.reconciled++
      }
      for (const inv of monthlyPaid) {
        const key = `${inv.updatedAt.getUTCFullYear()}-${inv.updatedAt.getUTCMonth() + 1}`
        const b = chartMap.get(key)
        if (b) b.paid++
      }

      type VendorRow = {
        vendorId: string
        vendorName: string
        invoiced: number
        reconciled: number
        paid: number
        pending: number
      }
      const vendorMap = new Map<string, VendorRow>()

      for (const inv of vendorCurrentMonth) {
        const vid = inv.vendor.id
        if (!vendorMap.has(vid)) {
          vendorMap.set(vid, {
            vendorId: vid,
            vendorName: inv.vendor.name,
            invoiced: 0,
            reconciled: 0,
            paid: 0,
            pending: 0,
          })
        }
        const v = vendorMap.get(vid)!
        v.invoiced += Number(inv.invoiceAmount)

        for (const grn of inv.grnEntries) {
          const amt = Number(grn.grnAmount)
          if (grn.status === 'reconciled' || grn.status === 'paid') v.reconciled += amt
          if (grn.status === 'paid') v.paid += amt
        }
        v.pending = v.invoiced - v.reconciled
      }

      return {
        totalInvoices,
        pendingReview,
        reconciledThisMonth,
        paidThisMonthAmount: Number(paidThisMonthAgg._sum.totalAmount ?? 0),
        monthlyChart: Array.from(chartMap.values()),
        vendorSummaryCurrentMonth: Array.from(vendorMap.values()),
        recentActivity: recentActivity.map(log => ({
          action: log.action,
          entityType: log.entityType,
          userName: log.user?.name ?? null,
          createdAt: log.createdAt,
        })),
      }
    },
  )

  // GET /reports/reconciliation-summary
  fastify.get(
    '/reconciliation-summary',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { month, year } = reconSummaryQuerySchema.parse(request.query)

      const reconRun = await fastify.prisma.reconciliationRun.findFirst({
        where: { periodMonth: month, periodYear: year, status: 'completed' },
        orderBy: { createdAt: 'desc' },
      })

      if (!reconRun) {
        return {
          matched: 0,
          amountDiff: 0,
          appOnly: 0,
          excelOnly: 0,
          disputed: 0,
          byVendor: [],
          byDepartment: [],
        }
      }

      const results = await fastify.prisma.reconResult.findMany({
        where: { reconRunId: reconRun.id },
        select: {
          matchStatus: true,
          resolution: true,
          grnEntry: {
            select: {
              invoice: {
                select: {
                  vendor: { select: { id: true, name: true } },
                  department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      })

      const matched = results.filter(r => r.matchStatus === 'matched').length
      const amountDiff = results.filter(r => r.matchStatus === 'amount_diff').length
      const appOnly = results.filter(r => r.matchStatus === 'app_only').length
      const excelOnly = results.filter(r => r.matchStatus === 'excel_only').length
      const disputed = results.filter(r => r.resolution === 'disputed').length

      type VendorSummary = {
        vendorId: string
        vendorName: string
        matched: number
        amountDiff: number
        appOnly: number
        excelOnly: number
      }
      type DeptSummary = {
        departmentId: string
        departmentName: string
        matched: number
        amountDiff: number
        appOnly: number
        excelOnly: number
      }

      const vendorMap = new Map<string, VendorSummary>()
      const deptMap = new Map<string, DeptSummary>()

      for (const r of results) {
        const invoice = r.grnEntry?.invoice
        if (!invoice) continue

        const v = invoice.vendor
        if (!vendorMap.has(v.id)) {
          vendorMap.set(v.id, {
            vendorId: v.id,
            vendorName: v.name,
            matched: 0,
            amountDiff: 0,
            appOnly: 0,
            excelOnly: 0,
          })
        }
        const vb = vendorMap.get(v.id)!
        if (r.matchStatus === 'matched') vb.matched++
        else if (r.matchStatus === 'amount_diff') vb.amountDiff++
        else if (r.matchStatus === 'app_only') vb.appOnly++
        else if (r.matchStatus === 'excel_only') vb.excelOnly++

        const dept = invoice.department
        if (dept) {
          if (!deptMap.has(dept.id)) {
            deptMap.set(dept.id, {
              departmentId: dept.id,
              departmentName: dept.name,
              matched: 0,
              amountDiff: 0,
              appOnly: 0,
              excelOnly: 0,
            })
          }
          const db = deptMap.get(dept.id)!
          if (r.matchStatus === 'matched') db.matched++
          else if (r.matchStatus === 'amount_diff') db.amountDiff++
          else if (r.matchStatus === 'app_only') db.appOnly++
          else if (r.matchStatus === 'excel_only') db.excelOnly++
        }
      }

      return {
        matched,
        amountDiff,
        appOnly,
        excelOnly,
        disputed,
        byVendor: Array.from(vendorMap.values()),
        byDepartment: Array.from(deptMap.values()),
      }
    },
  )

  // GET /reports/pending-invoices
  fastify.get(
    '/pending-invoices',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { departmentId } = pendingInvoicesQuerySchema.parse(request.query)
      const now = new Date()

      const invoices = await fastify.prisma.invoice.findMany({
        where: {
          status: { notIn: ['reconciled', 'paid'] },
          ...(departmentId ? { departmentId } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceAmount: true,
          status: true,
          billType: true,
          createdAt: true,
          vendor: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          uploader: { select: { id: true, name: true } },
          _count: { select: { grnEntries: true } },
        },
      })

      return invoices.map(inv => ({
        ...inv,
        invoiceAmount: Number(inv.invoiceAmount),
        daysPending: Math.floor(
          (now.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        ),
      }))
    },
  )

  // GET /reports/audit-log
  fastify.get(
    '/audit-log',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { userId, entityType, action, dateFrom, dateTo, page, limit } =
        auditLogQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const where = {
        ...(userId ? { userId } : {}),
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
        ...(dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
      }

      const [logs, total] = await Promise.all([
        fastify.prisma.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            newValue: true,
            oldValue: true,
            ipAddress: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        }),
        fastify.prisma.auditLog.count({ where }),
      ])

      return {
        data: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },
  )
}
