import { PrismaClient, Prisma, MatchStatus } from '@prisma/client'

export class ReconciliationService {
  constructor(private prisma: PrismaClient) {}

  async runReconciliation(periodMonth: number, periodYear: number, runBy: string) {
    const unresolvedConflicts = await this.prisma.grnConflict.count({
      where: { resolvedAt: null },
    })
    if (unresolvedConflicts > 0) {
      throw Object.assign(new Error('Resolve all GRN conflicts first'), {
        statusCode: 409,
        unresolvedConflicts,
      })
    }

    const run = await this.prisma.reconciliationRun.create({
      data: { periodMonth, periodYear, runBy, status: 'running' },
    })

    const periodStart = new Date(periodYear, periodMonth - 1, 1)
    const periodEnd = new Date(periodYear, periodMonth, 1)

    const [invoices, grnMasters] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          status: 'approved',
          billType: 'grn_bill',
          invoiceDate: { gte: periodStart, lt: periodEnd },
        },
        include: { vendor: true, grnEntries: true },
      }),
      this.prisma.grnMaster.findMany({
        where: { grnDate: { gte: periodStart, lt: periodEnd } },
        include: { vendor: true },
      }),
    ])

    type GrnMasterRow = (typeof grnMasters)[0]
    const masterMap = new Map<string, GrnMasterRow>()
    for (const master of grnMasters) {
      if (!master.vendor || !master.invoiceNumber) continue
      const key = `${master.vendor.name.toLowerCase()}::${master.invoiceNumber.toLowerCase()}::${master.grnNumber.toLowerCase()}`
      masterMap.set(key, master)
    }

    const matchedMasterIds = new Set<string>()
    const reconResultsData: Prisma.ReconResultCreateManyInput[] = []
    const grnEntriesToReconcile: string[] = []

    for (const invoice of invoices) {
      for (const grnEntry of invoice.grnEntries) {
        const key = `${invoice.vendor.name.toLowerCase()}::${invoice.invoiceNumber.toLowerCase()}::${grnEntry.grnNumber.toLowerCase()}`
        const master = masterMap.get(key)

        if (!master) {
          reconResultsData.push({
            reconRunId: run.id,
            grnEntryId: grnEntry.id,
            grnMasterId: null,
            matchStatus: MatchStatus.app_only,
            appAmount: grnEntry.grnAmount,
            excelAmount: null,
          })
        } else {
          matchedMasterIds.add(master.id)
          const diff = Math.abs(Number(grnEntry.grnAmount) - Number(master.grnAmount))
          if (diff <= 0.01) {
            reconResultsData.push({
              reconRunId: run.id,
              grnEntryId: grnEntry.id,
              grnMasterId: master.id,
              matchStatus: MatchStatus.matched,
              appAmount: grnEntry.grnAmount,
              excelAmount: master.grnAmount,
            })
            grnEntriesToReconcile.push(grnEntry.id)
          } else {
            reconResultsData.push({
              reconRunId: run.id,
              grnEntryId: grnEntry.id,
              grnMasterId: master.id,
              matchStatus: MatchStatus.amount_diff,
              appAmount: grnEntry.grnAmount,
              excelAmount: master.grnAmount,
            })
          }
        }
      }
    }

    for (const master of grnMasters) {
      if (!matchedMasterIds.has(master.id)) {
        reconResultsData.push({
          reconRunId: run.id,
          grnEntryId: null,
          grnMasterId: master.id,
          matchStatus: MatchStatus.excel_only,
          appAmount: null,
          excelAmount: master.grnAmount,
        })
      }
    }

    const totalMatched = reconResultsData.filter((r) => r.matchStatus === MatchStatus.matched).length
    const totalAmountDiff = reconResultsData.filter(
      (r) => r.matchStatus === MatchStatus.amount_diff,
    ).length
    const totalAppOnly = reconResultsData.filter((r) => r.matchStatus === MatchStatus.app_only).length
    const totalExcelOnly = reconResultsData.filter(
      (r) => r.matchStatus === MatchStatus.excel_only,
    ).length

    await this.prisma.$transaction(async (tx) => {
      await tx.reconResult.createMany({ data: reconResultsData })

      if (grnEntriesToReconcile.length > 0) {
        await tx.grnEntry.updateMany({
          where: { id: { in: grnEntriesToReconcile } },
          data: { status: 'reconciled' },
        })

        const affectedInvoiceIds = [
          ...new Set(
            invoices
              .filter((inv) => inv.grnEntries.some((ge) => grnEntriesToReconcile.includes(ge.id)))
              .map((inv) => inv.id),
          ),
        ]

        for (const invoiceId of affectedInvoiceIds) {
          const invoice = invoices.find((inv) => inv.id === invoiceId)!
          const allReconciled = invoice.grnEntries.every((ge) =>
            grnEntriesToReconcile.includes(ge.id),
          )
          if (allReconciled) {
            await tx.invoice.update({
              where: { id: invoiceId },
              data: { status: 'reconciled' },
            })
          }
        }
      }

      await tx.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          totalMatched,
          totalAmountDiff,
          totalAppOnly,
          totalExcelOnly,
        },
      })
    })

    return {
      runId: run.id,
      totalMatched,
      totalAmountDiff,
      totalAppOnly,
      totalExcelOnly,
    }
  }

  async completeRun(reconRunId: string, completedBy: string) {
    const unresolvedCount = await this.prisma.reconResult.count({
      where: {
        reconRunId,
        matchStatus: { not: MatchStatus.matched },
        resolution: null,
      },
    })

    if (unresolvedCount > 0) {
      throw Object.assign(new Error(`${unresolvedCount} result(s) require resolution before completing`), {
        statusCode: 400,
        unresolvedCount,
      })
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reconciliationRun.update({
        where: { id: reconRunId },
        data: { completedAt: new Date(), completedBy },
      })

      await tx.auditLog.create({
        data: {
          userId: completedBy,
          action: 'COMPLETE',
          entityType: 'ReconciliationRun',
          entityId: reconRunId,
        },
      })
    })
  }
}
