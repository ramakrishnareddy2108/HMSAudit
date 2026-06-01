# P08 — GRN Excel Sync (Admin)

Read CLAUDE.md first.

## Backend

TARGET: apps/api/src/services/excelService.ts (create)

class ExcelService:
parseGrnExcel(buffer: Buffer): GrnRow[]
- Use SheetJS (xlsx) to parse buffer
- Accept column names case-insensitive with trim:
  vendor_name/vendor, invoice_number/invoice_no, grn_number/grn_no, grn_amount/amount, grn_date/date
- Skip rows where grnNumber is empty
- Throw descriptive error if required columns missing
- Return: { vendorName, invoiceNumber, grnNumber, grnAmount, grnDate }[]

TARGET: apps/api/src/routes/grnSync.ts (create, register at prefix /grn-sync)

POST /grn-sync/upload
- requireRole('admin')
- Accept multipart: Excel file (.xlsx or .xls only)
- Upload file to Supabase Storage: grn-excel/{userId}/{timestamp}.xlsx
- Create GrnSyncRun with status=processing
- Parse with ExcelService
- For each row in Prisma transaction:
  1. Find vendor by name case-insensitive — skip row if not found (log warning)
  2. Check grn_master for grnNumber
  3. Not found → insert GrnMaster, increment inserted
  4. Found + amounts match (within 0.01) → skip, increment skipped
  5. Found + amounts differ → create GrnConflict, increment conflicts
- Update GrnSyncRun: status = has_conflicts (if conflicts>0) else completed
- Return: { syncRunId, inserted, skipped, conflicts, status }

GET /grn-sync/runs — requireRole('admin'), list ordered by createdAt desc, include runner name
GET /grn-sync/runs/:id/conflicts — requireRole('admin'), unresolved conflicts for this run

POST /grn-sync/runs/:id/conflicts/:conflictId/resolve
- requireRole('admin')
- Body: { resolution: 'keep_system' | 'use_excel', adminNote: string (required) }
- If use_excel: update grn_master.grnAmount = excelAmount
- Update conflict: resolvedBy, resolution, adminNote, resolvedAt
- If all conflicts for this run resolved: update run status to completed
- Write audit_log

## Frontend

TARGET: apps/web/src/pages/admin/GrnSyncPage.tsx

Upload panel:
- Last sync info: "Last synced: [date] by [user] ([count] records)"
- Drag-drop zone: .xlsx and .xls only
- "Upload & Sync" button with processing spinner
- Result summary after sync: "✅ 398 added | ✅ 18 skipped | ⚠️ 7 conflicts"

Sync history table: Date | Uploaded by | Inserted | Skipped | Conflicts | Status

Conflicts panel (shown when unresolved conflicts exist):
- Red banner: "X conflicts require resolution before reconciliation"
- Each conflict card: GRN number | System amount | Excel amount | Difference | Admin note textarea | [Keep System] [Use Excel] buttons
- Progress: "3 of 7 resolved"
- All resolved → green "Ready to reconcile"
