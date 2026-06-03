import { PrismaClient, Prisma, MatchStatus, Resolution } from '@prisma/client'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export class ReconciliationService {
  constructor(private prisma: PrismaClient) {}

  private async checkAndReconcileInvoice(tx: TransactionClient, invoiceId: string) {
    const allEntries = await tx.grnEntry.findMany({
      where: { invoiceId },
      select: { status: true },
    })
    if (allEntries.length > 0 && allEntries.every((e) => e.status === 'reconciled' || e.status === 'paid')) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'reconciled' } })
    }
  }

  private validateResolution(matchStatus: MatchStatus, resolution: Resolution) {
    const valid: Record<MatchStatus, Resolution[]> = {
      [MatchStatus.matched]: [],
      [MatchStatus.amount_diff]: [Resolution.accepted_app, Resolution.accepted_excel, Resolution.disputed],
      [MatchStatus.grn_not_found]: [Resolution.sent_back, Resolution.disputed, Resolution.override_valid],
      [MatchStatus.invoice_only]: [
        Resolution.sent_back,
        Resolution.disputed,
        Resolution.override_valid,
        Resolution.accepted_partial,
      ],
      [MatchStatus.excel_only]: [Resolution.pending_upload, Resolution.not_required],
    }
    if (!valid[matchStatus]?.includes(resolution)) {
      throw Object.assign(
        new Error(`Resolution '${resolution}' is not valid for match status '${matchStatus}'`),
        { statusCode: 400 },
      )
    }
  }

  private async resetPeriod(
    hospitalId: string,
    periodMonth: number,
    periodYear: number,
    periodStart: Date,
    periodEnd: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const previousRuns = await tx.reconciliationRun.findMany({
        where: { hospitalId, periodMonth, periodYear },
        select: { id: true },
      })
      const previousRunIds = previousRuns.map((r) => r.id)

      if (previousRunIds.length > 0) {
        await tx.reconResult.deleteMany({ where: { reconRunId: { in: previousRunIds } } })
        await tx.reconciliationRun.deleteMany({ where: { id: { in: previousRunIds } } })
      }

      const invoicesInPeriod = await tx.invoice.findMany({
        where: {
          hospitalId,
          billType: 'grn_bill',
          status: { in: ['approved', 'reconciled'] },
          invoiceDate: { gte: periodStart, lt: periodEnd },
        },
        select: { id: true },
      })
      const invoiceIds = invoicesInPeriod.map((i) => i.id)

      if (invoiceIds.length > 0) {
        await tx.grnEntry.updateMany({
          where: { invoiceId: { in: invoiceIds }, status: { in: ['reconciled', 'disputed'] } },
          data: { status: 'pending' },
        })
        await tx.invoice.updateMany({
          where: { id: { in: invoiceIds }, status: 'reconciled' },
          data: { status: 'approved' },
        })
      }
    })
  }

  async runReconciliation(
    periodMonth: number,
    periodYear: number,
    runBy: string,
    hospitalId: string,
    force = false,
  ) {
    const unresolvedConflicts = await this.prisma.grnConflict.count({
      where: { resolvedAt: null, hospitalId },
    })
    if (unresolvedConflicts > 0) {
      throw Object.assign(
        new Error(
          `${unresolvedConflicts} unresolved GRN conflict(s) must be resolved before running reconciliation`,
        ),
        { statusCode: 409, unresolvedConflicts },
      )
    }

    const periodStart = new Date(periodYear, periodMonth - 1, 1)
    const periodEnd = new Date(periodYear, periodMonth, 1)

    type RunRow = Awaited<ReturnType<typeof this.prisma.reconciliationRun.findFirst>>
    let run: NonNullable<RunRow>

    if (force) {
      await this.resetPeriod(hospitalId, periodMonth, periodYear, periodStart, periodEnd)
      run = await this.prisma.reconciliationRun.create({
        data: { periodMonth, periodYear, runBy, status: 'running', hospitalId },
      })
    } else {
      const existing = await this.prisma.reconciliationRun.findFirst({
        where: { hospitalId, periodMonth, periodYear, status: 'running' },
        orderBy: { createdAt: 'desc' },
      })
      run = existing ?? (await this.prisma.reconciliationRun.create({
        data: { periodMonth, periodYear, runBy, status: 'running', hospitalId },
      }))
    }

    // Track entries/masters already processed in this run for incremental force=false
    const existingEntryIds = new Set<string>()
    const existingMasterIds = new Set<string>()
    if (!force) {
      const existingResults = await this.prisma.reconResult.findMany({
        where: { reconRunId: run.id },
        select: { grnEntryId: true, grnMasterId: true },
      })
      for (const r of existingResults) {
        if (r.grnEntryId) existingEntryIds.add(r.grnEntryId)
        if (r.grnMasterId) existingMasterIds.add(r.grnMasterId)
      }
    }

    const [invoices, grnMasters] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          status: 'approved',
          billType: 'grn_bill',
          invoiceDate: { gte: periodStart, lt: periodEnd },
        },
        include: {
          vendor: true,
          grnEntries: true,
        },
      }),
      this.prisma.grnMaster.findMany({
        where: { grnDate: { gte: periodStart, lt: periodEnd } },
        include: { vendor: true },
      }),
    ])

    type GrnMasterRow = (typeof grnMasters)[0]
    const masterMap = new Map<string, GrnMasterRow>()
    const masterByGrnNumber = new Map<string, GrnMasterRow>()
    for (const master of grnMasters) {
      masterByGrnNumber.set(master.grnNumber.toLowerCase(), master)
      if (!master.vendor || !master.invoiceNumber) continue
      const key = `${master.vendor.name.toLowerCase()}::${master.invoiceNumber.toLowerCase()}::${master.grnNumber.toLowerCase()}`
      masterMap.set(key, master)
    }

    const matchedMasterIds = new Set<string>()
    const reconResultsData: Prisma.ReconResultCreateManyInput[] = []
    const grnEntriesToReconcile: string[] = []

    for (const invoice of invoices) {
      for (const grnEntry of invoice.grnEntries) {
        if (grnEntry.status === 'paid') continue
        if (!force && (grnEntry.status === 'reconciled' || existingEntryIds.has(grnEntry.id))) continue

        const key = `${invoice.vendor.name.toLowerCase()}::${invoice.invoiceNumber.toLowerCase()}::${grnEntry.grnNumber.toLowerCase()}`
        const master = masterMap.get(key)

        if (!master) {
          const partialMaster = masterByGrnNumber.get(grnEntry.grnNumber.toLowerCase())
          reconResultsData.push({
            hospitalId,
            reconRunId: run.id,
            grnEntryId: grnEntry.id,
            grnMasterId: partialMaster?.id ?? null,
            matchStatus: partialMaster ? MatchStatus.invoice_only : MatchStatus.grn_not_found,
            appAmount: grnEntry.grnAmount,
            excelAmount: partialMaster?.grnAmount ?? null,
          })
        } else {
          matchedMasterIds.add(master.id)
          const diff = Math.abs(Number(grnEntry.grnAmount) - Number(master.grnAmount))
          if (diff <= 0.01) {
            reconResultsData.push({
              hospitalId,
              reconRunId: run.id,
              grnEntryId: grnEntry.id,
              grnMasterId: master.id,
              matchStatus: MatchStatus.matched,
              resolution: Resolution.auto_matched,
              resolvedAt: new Date(),
              appAmount: grnEntry.grnAmount,
              excelAmount: master.grnAmount,
            })
            grnEntriesToReconcile.push(grnEntry.id)
          } else {
            reconResultsData.push({
              hospitalId,
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
      if (!matchedMasterIds.has(master.id) && !existingMasterIds.has(master.id)) {
        reconResultsData.push({
          hospitalId,
          reconRunId: run.id,
          grnEntryId: null,
          grnMasterId: master.id,
          matchStatus: MatchStatus.excel_only,
          appAmount: null,
          excelAmount: master.grnAmount,
        })
      }
    }

    const newMatched = reconResultsData.filter((r) => r.matchStatus === MatchStatus.matched).length
    const newAmountDiff = reconResultsData.filter((r) => r.matchStatus === MatchStatus.amount_diff).length
    const newAppOnly = reconResultsData.filter(
      (r) => r.matchStatus === MatchStatus.grn_not_found || r.matchStatus === MatchStatus.invoice_only,
    ).length
    const newExcelOnly = reconResultsData.filter((r) => r.matchStatus === MatchStatus.excel_only).length

    const baseTotals = {
      totalMatched: run.totalMatched,
      totalAmountDiff: run.totalAmountDiff,
      totalAppOnly: run.totalAppOnly,
      totalExcelOnly: run.totalExcelOnly,
    }

    await this.prisma.$transaction(async (tx) => {
      if (reconResultsData.length > 0) {
        await tx.reconResult.createMany({ data: reconResultsData })
      }

      if (matchedMasterIds.size > 0) {
        await tx.grnMaster.updateMany({
          where: { id: { in: Array.from(matchedMasterIds) }, pendingUpload: true },
          data: { pendingUpload: false },
        })
      }

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
          await this.checkAndReconcileInvoice(tx, invoiceId)
        }
      }

      await tx.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          totalMatched: baseTotals.totalMatched + newMatched,
          totalAmountDiff: baseTotals.totalAmountDiff + newAmountDiff,
          totalAppOnly: baseTotals.totalAppOnly + newAppOnly,
          totalExcelOnly: baseTotals.totalExcelOnly + newExcelOnly,
        },
      })
    })

    return {
      runId: run.id,
      totalMatched: baseTotals.totalMatched + newMatched,
      totalAmountDiff: baseTotals.totalAmountDiff + newAmountDiff,
      totalAppOnly: baseTotals.totalAppOnly + newAppOnly,
      totalExcelOnly: baseTotals.totalExcelOnly + newExcelOnly,
    }
  }

  async resolveResult(
    reconRunId: string,
    resultId: string,
    resolution: Resolution,
    adminNote: string,
    userId: string,
    hospitalId: string,
  ) {
    const result = await this.prisma.reconResult.findFirst({
      where: { id: resultId, reconRunId, hospitalId },
      include: {
        grnEntry: { include: { invoice: true } },
        grnMaster: true,
      },
    })

    if (!result) throw Object.assign(new Error('Result not found'), { statusCode: 404 })
    if (result.resolution !== null) {
      throw Object.assign(new Error('Result already resolved'), { statusCode: 409 })
    }

    this.validateResolution(result.matchStatus, resolution)

    const grnEntry = result.grnEntry

    await this.prisma.$transaction(async (tx) => {
      const reconUpdate: Prisma.ReconResultUncheckedUpdateInput = {
        resolution,
        resolvedBy: userId,
        adminNote,
        resolvedAt: new Date(),
      }

      if (result.matchStatus === MatchStatus.amount_diff) {
        if (resolution === Resolution.accepted_app) {
          reconUpdate.resolvedAmount = result.appAmount
          await tx.grnEntry.update({ where: { id: result.grnEntryId! }, data: { status: 'reconciled' } })
          await this.checkAndReconcileInvoice(tx, grnEntry!.invoiceId)
        } else if (resolution === Resolution.accepted_excel) {
          reconUpdate.resolvedAmount = result.excelAmount
          await tx.grnEntry.update({
            where: { id: result.grnEntryId! },
            data: { grnAmount: result.excelAmount!, status: 'reconciled' },
          })
          await this.checkAndReconcileInvoice(tx, grnEntry!.invoiceId)
        } else if (resolution === Resolution.disputed) {
          await tx.grnEntry.update({ where: { id: result.grnEntryId! }, data: { status: 'disputed' } })
        }
      } else if (
        result.matchStatus === MatchStatus.grn_not_found ||
        result.matchStatus === MatchStatus.invoice_only
      ) {
        if (resolution === Resolution.sent_back) {
          reconUpdate.sentBackAt = new Date()
          reconUpdate.sentBackNote = adminNote
          await tx.invoice.update({
            where: { id: grnEntry!.invoiceId },
            data: { status: 'sent_back', reviewerNote: adminNote },
          })
        } else if (resolution === Resolution.disputed) {
          await tx.grnEntry.update({ where: { id: result.grnEntryId! }, data: { status: 'disputed' } })
        } else if (resolution === Resolution.override_valid || resolution === Resolution.accepted_partial) {
          reconUpdate.resolvedAmount = result.appAmount
          await tx.grnEntry.update({ where: { id: result.grnEntryId! }, data: { status: 'reconciled' } })
          await this.checkAndReconcileInvoice(tx, grnEntry!.invoiceId)
        }
      } else if (result.matchStatus === MatchStatus.excel_only) {
        if (resolution === Resolution.pending_upload) {
          await tx.grnMaster.update({ where: { id: result.grnMasterId! }, data: { pendingUpload: true } })
        }
      }

      await tx.reconResult.update({ where: { id: resultId }, data: reconUpdate })
    })
  }

  async fixGrnNumber(resultId: string, newGrnNumber: string, hospitalId: string) {
    const result = await this.prisma.reconResult.findFirst({
      where: { id: resultId, hospitalId },
      include: {
        grnEntry: { include: { invoice: { include: { vendor: true } } } },
      },
    })

    if (!result) throw Object.assign(new Error('Result not found'), { statusCode: 404 })
    if (!result.grnEntry) {
      throw Object.assign(new Error('No GRN entry associated with this result'), { statusCode: 400 })
    }

    const newMaster = await this.prisma.grnMaster.findFirst({
      where: { grnNumber: newGrnNumber, hospitalId },
      include: { vendor: true },
    })

    let newMatchStatus: MatchStatus
    let newExcelAmount: Prisma.Decimal | null = null

    if (!newMaster) {
      newMatchStatus = MatchStatus.grn_not_found
    } else if (
      newMaster.vendor?.name.toLowerCase() === result.grnEntry.invoice.vendor.name.toLowerCase() &&
      newMaster.invoiceNumber?.toLowerCase() === result.grnEntry.invoice.invoiceNumber.toLowerCase()
    ) {
      const diff = Math.abs(Number(result.grnEntry.grnAmount) - Number(newMaster.grnAmount))
      newMatchStatus = diff <= 0.01 ? MatchStatus.matched : MatchStatus.amount_diff
      newExcelAmount = newMaster.grnAmount
    } else {
      newMatchStatus = MatchStatus.invoice_only
      newExcelAmount = newMaster.grnAmount
    }

    const grnEntry = result.grnEntry

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.grnEntry.update({
          where: { id: result.grnEntryId! },
          data: { grnNumber: newGrnNumber },
        })

        const reconUpdate: Prisma.ReconResultUncheckedUpdateInput = {
          matchStatus: newMatchStatus,
          grnMasterId: newMaster?.id ?? null,
          excelAmount: newExcelAmount,
          resolution: null,
          resolvedAt: null,
          resolvedBy: null,
          adminNote: null,
          resolvedAmount: null,
          sentBackAt: null,
          sentBackNote: null,
        }

        if (newMatchStatus === MatchStatus.matched) {
          reconUpdate.resolution = Resolution.auto_matched
          reconUpdate.resolvedAt = new Date()
          await tx.grnEntry.update({ where: { id: result.grnEntryId! }, data: { status: 'reconciled' } })
          await this.checkAndReconcileInvoice(tx, grnEntry.invoiceId)
        }

        return tx.reconResult.update({
          where: { id: resultId },
          data: reconUpdate,
          include: {
            grnEntry: {
              include: {
                invoice: {
                  select: {
                    id: true,
                    invoiceNumber: true,
                    invoiceAmount: true,
                    vendor: { select: { id: true, name: true } },
                  },
                },
              },
            },
            grnMaster: { include: { vendor: { select: { id: true, name: true } } } },
          },
        })
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw Object.assign(
          new Error(`GRN number '${newGrnNumber}' is already assigned to another invoice`),
          { statusCode: 409 },
        )
      }
      throw err
    }
  }

  async completeRun(reconRunId: string, completedBy: string, hospitalId: string) {
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
          hospitalId,
        },
      })
    })
  }
}
