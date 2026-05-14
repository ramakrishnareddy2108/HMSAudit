import { PrismaClient } from '@prisma/client'

export class ReconciliationService {
  constructor(private prisma: PrismaClient) {}

  async runReconciliation(periodMonth: number, periodYear: number, runBy: string) {
    // TODO: implement
    // 1. Fetch all GrnEntries for the period (via their invoices)
    // 2. Fetch all GrnMaster records for the period
    // 3. Match by grnNumber, compare amounts
    // 4. Create ReconciliationRun and ReconResult rows
    throw new Error('Not implemented')
  }

  async completeRun(reconRunId: string, completedBy: string) {
    // TODO: implement
    throw new Error('Not implemented')
  }
}
