import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { InvoiceStatus, BillType, GrnEntryStatus, PaymentMode } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { getVendorFinancialSummary } from '../services/dashboardStatsService'

const vendorLedgerQuerySchema = z.object({
  vendorId: z.string().uuid(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
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
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

export default async function reportsRoutes(fastify: FastifyInstance) {
  // GET /reports/vendor-ledger
  fastify.get(
    '/vendor-ledger',
    {
      schema: { tags: ['Reports'], summary: 'Get vendor ledger with monthly breakdown' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { vendorId, dateFrom, dateTo } = vendorLedgerQuerySchema.parse(request.query)
      const hospitalId = request.user.activeHospitalId
      if (!hospitalId) return reply.status(400).send({ error: 'No active hospital selected' })

      const now = new Date()
      const dateToDate = dateTo
        ? new Date(dateTo + 'T23:59:59.999Z')
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
      const dateFromDate = dateFrom
        ? new Date(dateFrom + 'T00:00:00.000Z')
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()))

      const INCLUDED_STATUSES: InvoiceStatus[] = ['approved', 'reconciled', 'paid']
      const UNDER_REVIEW_STATUSES: InvoiceStatus[] = ['draft', 'pending_review', 'sent_back', 're_submitted']

      const [
        openingBalance,
        includedInvoices,
        underReviewAgg,
        paymentsInRange,
        reconciledAgg,
        readyToPayAgg,
        needsReconAgg,
        pendingUploadAgg,
      ] = await Promise.all([
        fastify.prisma.vendorOpeningBalance.findUnique({
          where: { vendorId_hospitalId: { vendorId, hospitalId } },
        }),
        fastify.prisma.invoice.findMany({
          where: {
            vendorId,
            status: { in: INCLUDED_STATUSES },
            invoiceDate: { gte: dateFromDate, lte: dateToDate },
          },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            invoiceAmount: true,
            status: true,
            billType: true,
            grnEntries: {
              where: { isDeleted: false },
              select: {
                grnNumber: true,
                grnAmount: true,
                grnDate: true,
                status: true,
                paymentGrns: {
                  take: 1,
                  select: {
                    payment: { select: { transactionRef: true, paymentDate: true } },
                  },
                },
              },
            },
          },
          orderBy: { invoiceDate: 'asc' },
        }),
        fastify.prisma.invoice.aggregate({
          where: { vendorId, status: { in: UNDER_REVIEW_STATUSES } },
          _count: { _all: true },
          _sum: { invoiceAmount: true },
        }),
        fastify.prisma.payment.findMany({
          where: { vendorId, paymentDate: { gte: dateFromDate, lte: dateToDate } },
          include: { _count: { select: { paymentGrns: true } } },
          orderBy: { paymentDate: 'asc' },
        }),
        fastify.prisma.paymentGrn.aggregate({
          where: { grn: { invoice: { vendorId }, isDeleted: false } },
          _sum: { amountPaid: true },
        }),
        fastify.prisma.grnEntry.findMany({
          where: {
            invoice: { vendorId, isDeleted: false },
            status: { in: ['reconciled', 'partial_paid'] },
          },
          select: { grnAmount: true, paidAmount: true },
        }),
        fastify.prisma.invoice.findMany({
          where: {
            vendorId,
            status: 'approved',
            grnEntries: {
              none: {
                status: { in: ['reconciled', 'partial_paid', 'paid'] },
                isDeleted: false,
              },
            },
          },
          select: { invoiceAmount: true },
        }),
        fastify.prisma.grnMaster.aggregate({
          where: { vendorId, pendingUpload: true },
          _count: { _all: true },
          _sum: { grnAmount: true },
        }),
      ])

      const openingBalanceAmount = openingBalance ? Number(openingBalance.amount) : 0
      const totalBilled = includedInvoices.reduce((s, inv) => s + Number(inv.invoiceAmount), 0)
      const totalPaid = paymentsInRange.reduce((s, p) => s + Number(p.totalAmount), 0)
      // reconciledAgg is now PaymentGrn aggregate (amountPaid sum = actual paid)
      const totalReconciled = Number((reconciledAgg as { _sum: { amountPaid?: unknown } })._sum.amountPaid ?? 0)
      // readyToPayAgg is now an array of partial/reconciled GRNs — sum remaining amounts
      const readyToPay = (readyToPayAgg as Array<{ grnAmount: unknown; paidAmount: unknown }>).reduce(
        (s, g) => s + Number(g.grnAmount) - Number(g.paidAmount),
        0,
      )

      const summary = {
        openingBalance: openingBalance ?? null,
        totalBilled,
        totalPaid,
        totalReconciled,
        totalOutstanding: totalBilled - totalPaid + openingBalanceAmount,
        readyToPay,
        needsReconciliation: needsReconAgg.reduce((s, inv) => s + Number(inv.invoiceAmount), 0),
        underReview: {
          count: underReviewAgg._count._all,
          amount: Number(underReviewAgg._sum.invoiceAmount ?? 0),
        },
        invoiceCount: includedInvoices.length,
      }

      const MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ]

      type GrnItem = {
        grnNumber: string; grnAmount: number; grnDate: Date | null
        status: GrnEntryStatus; paymentRef: string | null; paymentDate: Date | null
      }
      type InvoiceItem = {
        id: string; invoiceNumber: string; invoiceDate: Date | null
        invoiceAmount: number; status: InvoiceStatus; billType: BillType
        grns: GrnItem[]; paymentRef: string | null; paymentDate: Date | null
      }
      type PaymentItem = {
        id: string; paymentDate: Date; amount: number
        paymentMode: PaymentMode; transactionRef: string | null; grnCount: number
      }
      type MonthData = {
        month: number; year: number; label: string
        openingBalance: number; closingBalance: number
        monthTotalBilled: number; monthTotalPaid: number
        invoices: InvoiceItem[]; payments: PaymentItem[]
      }

      // Generate all months from dateFrom to dateTo (oldest → newest)
      const buckets = new Map<string, MonthData>()
      {
        let cur = new Date(Date.UTC(dateFromDate.getUTCFullYear(), dateFromDate.getUTCMonth(), 1))
        const end = new Date(Date.UTC(dateToDate.getUTCFullYear(), dateToDate.getUTCMonth() + 1, 1))
        while (cur < end) {
          const m = cur.getUTCMonth() + 1
          const y = cur.getUTCFullYear()
          buckets.set(`${y}-${String(m).padStart(2, '0')}`, {
            month: m, year: y,
            label: `${MONTH_NAMES[m - 1]} ${y}`,
            openingBalance: 0, closingBalance: 0,
            monthTotalBilled: 0, monthTotalPaid: 0,
            invoices: [], payments: [],
          })
          cur = new Date(Date.UTC(y, m, 1))
        }
      }

      for (const inv of includedInvoices) {
        if (!inv.invoiceDate) continue
        const m = inv.invoiceDate.getUTCMonth() + 1
        const y = inv.invoiceDate.getUTCFullYear()
        const bucket = buckets.get(`${y}-${String(m).padStart(2, '0')}`)
        if (!bucket) continue

        const grns: GrnItem[] = inv.grnEntries.map((g) => ({
          grnNumber: g.grnNumber,
          grnAmount: Number(g.grnAmount),
          grnDate: g.grnDate,
          status: g.status,
          paymentRef: g.paymentGrns[0]?.payment?.transactionRef ?? null,
          paymentDate: g.paymentGrns[0]?.payment?.paymentDate ?? null,
        }))

        const firstPaidGrn = inv.grnEntries.find((g) => g.paymentGrns[0]?.payment)
        bucket.invoices.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          invoiceAmount: Number(inv.invoiceAmount),
          status: inv.status,
          billType: inv.billType,
          grns,
          paymentRef: firstPaidGrn?.paymentGrns[0]?.payment?.transactionRef ?? null,
          paymentDate: firstPaidGrn?.paymentGrns[0]?.payment?.paymentDate ?? null,
        })
        bucket.monthTotalBilled += Number(inv.invoiceAmount)
      }

      for (const payment of paymentsInRange) {
        const m = payment.paymentDate.getUTCMonth() + 1
        const y = payment.paymentDate.getUTCFullYear()
        const bucket = buckets.get(`${y}-${String(m).padStart(2, '0')}`)
        if (!bucket) continue

        bucket.payments.push({
          id: payment.id,
          paymentDate: payment.paymentDate,
          amount: Number(payment.totalAmount),
          paymentMode: payment.paymentMode,
          transactionRef: payment.transactionRef ?? null,
          grnCount: payment._count.paymentGrns,
        })
        bucket.monthTotalPaid += Number(payment.totalAmount)
      }

      // Running balance: oldest → newest
      let runningBalance = openingBalanceAmount
      const sortedKeys = Array.from(buckets.keys()).sort()
      const transactionsByMonth: MonthData[] = sortedKeys.map((key) => {
        const b = buckets.get(key)!
        b.openingBalance = runningBalance
        b.closingBalance = runningBalance + b.monthTotalBilled - b.monthTotalPaid
        runningBalance = b.closingBalance
        return b
      })
      transactionsByMonth.reverse()

      return {
        summary,
        transactionsByMonth,
        pendingUploadGrns: {
          count: pendingUploadAgg._count._all,
          totalAmount: Number(pendingUploadAgg._sum.grnAmount ?? 0),
        },
      }
    },
  )

  // GET /reports/dashboard-stats
  fastify.get(
    '/dashboard-stats',
    {
      schema: { tags: ['Reports'], summary: 'Get admin dashboard statistics' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hospitalId = request.user.activeHospitalId
      if (!hospitalId) return reply.status(400).send({ error: 'No active hospital selected' })

      const now = new Date()
      const MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ]

      // Last 3 months oldest→newest
      const months = Array.from({ length: 3 }, (_, i) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (2 - i), 1))
        return {
          month: d.getUTCMonth() + 1,
          year: d.getUTCFullYear(),
          start: d,
          end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
          label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        }
      })

      const [
        reviewQueueCount,
        reviewQueueOldest,
        sentBackCount,
        sentBackOldest,
        excelOnlyPendingCount,
        grnEntriesForRange,
        reconRuns,
        reviewedInvoicesForRange,
        vendorSummary,
      ] = await Promise.all([
        fastify.prisma.invoice.count({
          where: { status: { in: ['pending_review', 're_submitted'] }, isDeleted: false },
        }),
        fastify.prisma.invoice.findFirst({
          where: { status: { in: ['pending_review', 're_submitted'] }, isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        fastify.prisma.invoice.count({
          where: { status: 'sent_back', isDeleted: false },
        }),
        fastify.prisma.invoice.findFirst({
          where: { status: 'sent_back', isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        fastify.prisma.grnMaster.count({
          where: { pendingUpload: true },
        }),
        fastify.prisma.grnEntry.findMany({
          where: {
            grnDate: { gte: months[0].start },
            isDeleted: false,
          },
          select: { grnDate: true },
        }),
        fastify.prisma.reconciliationRun.findMany({
          where: {
            OR: months.map(({ month, year }) => ({ periodMonth: month, periodYear: year })),
            status: 'completed',
          },
          select: { id: true, periodMonth: true, periodYear: true },
          orderBy: { createdAt: 'desc' },
        }),
        fastify.prisma.invoice.findMany({
          where: {
            status: { in: ['approved', 'reconciled', 'paid'] },
            billType: { not: 'miscellaneous' },
            invoiceDate: { gte: months[0].start },
            isDeleted: false,
          },
          select: {
            invoiceDate: true,
            _count: { select: { grnEntries: { where: { isDeleted: false } } } },
          },
        }),
        // Uses same logic as vendor ledger: reconciled + partial_paid GRNs, grnAmount - paidAmount
        getVendorFinancialSummary(fastify.prisma, {}),
      ])

      // ── pendingActions ────────────────────────────────────────────────────
      const daysSince = (d: Date) =>
        Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))

      const pendingActions = {
        reviewQueueCount,
        reviewQueueOldestDaysAgo: reviewQueueOldest ? daysSince(reviewQueueOldest.createdAt) : 0,
        sentBackCount,
        sentBackOldestDaysAgo: sentBackOldest ? daysSince(sentBackOldest.createdAt) : 0,
        unreconciledAmount: vendorSummary.needsReconciliation,
        unreconciledInvoiceCount: vendorSummary.needsReconciliationInvoiceCount,
        excelOnlyPendingCount,
      }

      // ── vendorPaymentStatus ───────────────────────────────────────────────
      type VendorPaymentRow = {
        id: string; name: string
        readyToPayAmount: number; needsReconAmount: number
        underReviewAmount: number; totalOutstanding: number
      }
      const vendorPaymentStatus: VendorPaymentRow[] = vendorSummary.vendors
        .filter((v) => v.readyToPay > 0 || v.needsRecon > 0 || v.underReview > 0)
        .map((v) => ({
          id: v.vendorId,
          name: v.vendorName,
          readyToPayAmount: v.readyToPay,
          needsReconAmount: v.needsRecon,
          underReviewAmount: v.underReview,
          totalOutstanding: v.total,
        }))
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
        .slice(0, 10)

      // ── reconciliationStatus ──────────────────────────────────────────────
      const latestRunByMonth = new Map<string, string>()
      for (const run of reconRuns) {
        const key = `${run.periodYear}-${run.periodMonth}`
        if (!latestRunByMonth.has(key)) latestRunByMonth.set(key, run.id)
      }
      const reconRunIds = Array.from(latestRunByMonth.values())

      const pendingPaymentGrns = reconRunIds.length > 0
        ? await fastify.prisma.grnEntry.findMany({
            where: {
              status: 'reconciled',
              isDeleted: false,
              invoice: { status: { in: ['approved', 'reconciled'] }, isDeleted: false },
              reconResults: { some: { reconRunId: { in: reconRunIds } } },
            },
            select: {
              grnAmount: true,
              reconResults: {
                where: { reconRunId: { in: reconRunIds } },
                select: { reconRunId: true },
                take: 1,
              },
            },
          })
        : []

      const pendingPaymentByRun = new Map<string, number>()
      for (const g of pendingPaymentGrns) {
        const rid = g.reconResults[0]?.reconRunId
        if (!rid) continue
        pendingPaymentByRun.set(rid, (pendingPaymentByRun.get(rid) ?? 0) + Number(g.grnAmount))
      }

      const reconciliationStatus = months.map(({ month, year, start, end, label }) => {
        const grnUploaded = grnEntriesForRange.some(
          (g) => g.grnDate !== null && g.grnDate >= start && g.grnDate < end,
        )
        const reconRunId = latestRunByMonth.get(`${year}-${month}`)
        const reconciliationDone = grnUploaded && !!reconRunId
        const monthReviewedInvoices = reviewedInvoicesForRange.filter(
          (inv) => inv.invoiceDate !== null && inv.invoiceDate >= start && inv.invoiceDate < end,
        )
        const unresolvedCount = monthReviewedInvoices.filter((inv) => inv._count.grnEntries === 0).length
        const pendingPaymentAmount = reconRunId ? (pendingPaymentByRun.get(reconRunId) ?? 0) : 0

        let status: 'needs_grn' | 'needs_reconciliation' | 'has_disputes' | 'ready_to_pay' | 'complete'
        if (!grnUploaded) status = 'needs_grn'
        else if (!reconciliationDone) status = 'needs_reconciliation'
        else if (unresolvedCount > 0) status = 'has_disputes'
        else if (pendingPaymentAmount > 0) status = 'ready_to_pay'
        else status = 'complete'

        return { month, year, label, grnUploaded, reconciliationDone, unresolvedCount, pendingPaymentAmount, status }
      })

      const grnUploadPendingMonths = reconciliationStatus
        .filter((m) => !m.grnUploaded)
        .map((m) => m.label)

      return { pendingActions, vendorPaymentStatus, reconciliationStatus, grnUploadPendingMonths }
    },
  )

  // GET /reports/reconciliation-summary
  fastify.get(
    '/reconciliation-summary',
    {
      schema: { tags: ['Reports'], summary: 'Get reconciliation summary report' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
      const appOnly = results.filter(r => r.matchStatus === 'grn_not_found' || r.matchStatus === 'invoice_only').length
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
        else if (r.matchStatus === 'grn_not_found' || r.matchStatus === 'invoice_only') vb.appOnly++
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
          else if (r.matchStatus === 'grn_not_found' || r.matchStatus === 'invoice_only') db.appOnly++
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
    {
      schema: { tags: ['Reports'], summary: 'List pending invoices report' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
    {
      schema: { tags: ['Reports'], summary: 'Query audit log entries' },
      preHandler: [authenticate, requireRole('admin')],
    },
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
