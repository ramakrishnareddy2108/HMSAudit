# P09 — Reconciliation Engine (Admin)

Read CLAUDE.md first.

## Backend

TARGET: apps/api/src/services/reconciliationService.ts (create)

async runReconciliation(periodMonth: number, periodYear: number, runBy: string):

1. Check unresolved conflicts: prisma.grnConflict.count({ where: { resolvedAt: null } })
   If > 0: throw error "Resolve all GRN conflicts first"

2. Create ReconciliationRun with status=running

3. Fetch approved grn_bill invoices for period:
   where: { status: 'approved', billType: 'grn_bill', invoiceDate: { gte: periodStart, lt: periodEnd } }
   include: { vendor: true, grnEntries: true }

4. Fetch grn_master for same period:
   include: { vendor: true }

5. For each grnEntry in approved invoices:
   Find grn_master where vendor.name matches (case-insensitive) AND invoiceNumber matches AND grnNumber matches
   MATCHED: found + amounts within 0.01 tolerance
   AMOUNT_DIFF: found + amounts differ
   APP_ONLY: no match found
   Create ReconResult for each

6. For each grn_master NOT matched to any grnEntry: create ReconResult as EXCEL_ONLY

7. For MATCHED: update grnEntry.status = reconciled
   If ALL grnEntries on an invoice are reconciled: update invoice.status = reconciled

8. Update ReconciliationRun: status=completed, counts

TARGET: apps/api/src/routes/reconciliation.ts (create, register at /reconciliation)

POST /reconciliation/run — requireRole('admin'), body: { month, year }, call reconciliationService
GET /reconciliation/runs — requireRole('admin'), list ordered desc
GET /reconciliation/runs/:id/results
  - Query: matchStatus, vendorId, page, limit
  - Include grnEntry with invoice+vendor, grnMaster record
  - Return category counts for tab badges

POST /reconciliation/runs/:id/results/:resultId/resolve
  - Body: { resolution: 'accepted_app'|'accepted_excel'|'disputed', adminNote: string }
  - accepted_app/excel: update grnEntry.status = reconciled
  - disputed: update grnEntry.status = disputed
  - Update recon_result fields, write audit_log

POST /reconciliation/runs/:id/complete
  - Check all non-matched results have resolution — return 400 with unresolved count if not
  - Lock all reconciled grnEntries
  - Write audit_log

## Frontend

TARGET: apps/web/src/pages/admin/ReconciliationPage.tsx

Section 1 — Run panel:
- Month/Year picker (default current month)
- Warning banner if unresolved GRN conflicts: "Resolve X conflicts in GRN Sync first"
- "Run Reconciliation" button with loading state
- Result summary card: "✅ 245 Matched | ⚠️ 12 Amount Diff | ❌ 8 App Only | ❌ 3 Excel Only"

Section 2 — Results:
- Tab bar: All | Matched (N) | Amount Diff (N) | App Only (N) | Excel Only (N)
- Export to Excel button
- Table: GRN Number | Vendor | Invoice No. | App Amount | Excel Amount | Status | Resolve button
- Matched rows: green, no action button

Resolve drawer (shadcn Sheet, slides right):
- Invoice image thumbnail (click to expand)
- Full details + amounts comparison
- Admin note textarea (required)
- Buttons: "Accept App Value" | "Accept Excel Value" | "Mark Disputed"
- On action: close drawer, invalidate query

Section 3 — Complete button:
- "Mark Reconciliation Complete" button
- Confirm dialog: "X GRNs will be locked. This cannot be undone."

Section 4 — History table: Month | Run by | Date | Matched | Diff | Disputes | Status
