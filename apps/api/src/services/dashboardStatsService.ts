import { PrismaClient } from '@prisma/client'

export interface VendorSummaryRow {
  vendorId: string
  vendorName: string
  readyToPay: number
  needsRecon: number
  underReview: number
  total: number
  isCleared: boolean
}

export interface VendorFinancialSummary {
  totalBilled: number
  totalPaid: number
  netOutstanding: number
  readyToPay: number
  readyToPayGrnCount: number
  needsReconciliation: number
  needsReconciliationInvoiceCount: number
  underReview: number
  vendors: VendorSummaryRow[]
}

// Mirrors the vendor ledger aggregation logic exactly.
// readyToPay  = reconciled + partial_paid GRNs, sum(grnAmount - paidAmount)
// needsRecon  = approved invoices with no reconciled/partial_paid/paid GRNs (invoice amounts)
// underReview = draft + pending_review + sent_back + re_submitted invoice amounts
export async function getVendorFinancialSummary(
  prisma: PrismaClient,
  filters: {
    vendorId?: string
    hospitalId?: string
    dateFrom?: Date
    dateTo?: Date
  } = {},
): Promise<VendorFinancialSummary> {
  const { vendorId, hospitalId, dateFrom, dateTo } = filters

  const hospitalWhere = hospitalId ? { hospitalId } : {}
  const vendorWhere = vendorId ? { vendorId } : {}
  const paymentDateWhere =
    dateFrom || dateTo
      ? {
          paymentDate: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}
  const invoiceDateWhere =
    dateFrom || dateTo
      ? {
          invoiceDate: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}

  const [readyToPayGrns, needsReconInvoices, underReviewInvoices, billedAgg, paidAgg] =
    await Promise.all([
      // Mirrors vendor ledger readyToPayAgg: reconciled + partial_paid, sum(grnAmount - paidAmount)
      prisma.grnEntry.findMany({
        where: {
          ...hospitalWhere,
          status: { in: ['reconciled', 'partial_paid'] },
          invoice: { isDeleted: false, ...hospitalWhere, ...vendorWhere },
        },
        select: {
          grnAmount: true,
          paidAmount: true,
          invoice: { select: { vendor: { select: { id: true, name: true } } } },
        },
      }),

      // Mirrors vendor ledger needsReconAgg: approved invoices with no reconciled GRNs (invoice amounts)
      prisma.invoice.findMany({
        where: {
          ...hospitalWhere,
          ...vendorWhere,
          status: 'approved',
          grnEntries: {
            none: {
              status: { in: ['reconciled', 'partial_paid', 'paid'] },
              isDeleted: false,
            },
          },
        },
        select: {
          invoiceAmount: true,
          vendor: { select: { id: true, name: true } },
        },
      }),

      // Mirrors vendor ledger underReviewAgg: all in-review/draft invoice amounts
      prisma.invoice.findMany({
        where: {
          ...hospitalWhere,
          ...vendorWhere,
          status: { in: ['draft', 'pending_review', 'sent_back', 're_submitted'] },
        },
        select: {
          invoiceAmount: true,
          vendor: { select: { id: true, name: true } },
        },
      }),

      // totalBilled: approved/reconciled/paid invoices, optionally date-filtered
      prisma.invoice.aggregate({
        where: {
          ...hospitalWhere,
          ...vendorWhere,
          status: { in: ['approved', 'reconciled', 'paid'] },
          ...invoiceDateWhere,
        },
        _sum: { invoiceAmount: true },
      }),

      // totalPaid: payments, optionally date-filtered
      prisma.payment.aggregate({
        where: { ...hospitalWhere, ...vendorWhere, ...paymentDateWhere },
        _sum: { totalAmount: true },
      }),
    ])

  type VendorKey = { id: string; name: string }
  const vendorMap = new Map<string, VendorSummaryRow>()

  const ensure = (v: VendorKey): VendorSummaryRow => {
    if (!vendorMap.has(v.id)) {
      vendorMap.set(v.id, {
        vendorId: v.id,
        vendorName: v.name,
        readyToPay: 0,
        needsRecon: 0,
        underReview: 0,
        total: 0,
        isCleared: false,
      })
    }
    return vendorMap.get(v.id)!
  }

  let readyToPayGrnCount = 0
  for (const g of readyToPayGrns) {
    const remaining = Number(g.grnAmount) - Number(g.paidAmount)
    if (remaining > 0) {
      ensure(g.invoice.vendor).readyToPay += remaining
      readyToPayGrnCount++
    }
  }

  for (const inv of needsReconInvoices) {
    ensure(inv.vendor).needsRecon += Number(inv.invoiceAmount)
  }

  for (const inv of underReviewInvoices) {
    ensure(inv.vendor).underReview += Number(inv.invoiceAmount)
  }

  for (const v of vendorMap.values()) {
    v.total = v.readyToPay + v.needsRecon
    v.isCleared = v.readyToPay === 0 && v.needsRecon === 0
  }

  const vendors = Array.from(vendorMap.values())
  const readyToPay = vendors.reduce((s, v) => s + v.readyToPay, 0)
  const needsReconciliation = vendors.reduce((s, v) => s + v.needsRecon, 0)
  const underReview = vendors.reduce((s, v) => s + v.underReview, 0)
  const totalBilled = Number(billedAgg._sum.invoiceAmount ?? 0)
  const totalPaid = Number(paidAgg._sum.totalAmount ?? 0)

  return {
    totalBilled,
    totalPaid,
    netOutstanding: totalBilled - totalPaid,
    readyToPay,
    readyToPayGrnCount,
    needsReconciliation,
    needsReconciliationInvoiceCount: needsReconInvoices.length,
    underReview,
    vendors,
  }
}
