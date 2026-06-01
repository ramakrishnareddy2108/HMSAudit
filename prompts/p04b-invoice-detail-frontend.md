# P04b — Invoice Detail Page (Frontend)

Read CLAUDE.md first.

TARGET: apps/web/src/pages/invoices/InvoiceDetailPage.tsx

Two-column desktop layout, single column mobile.

LEFT PANEL — Image Viewer:
- Show invoice image (or PDF icon for PDFs)
- Zoom in/out + rotate buttons
- If isPriceRevised and versions.length > 1: show toggle "Version 1 (Original)" / "Version 2 (Current)"
- Switching toggle shows image from that version

RIGHT PANEL:

Section 1 — Status + Timeline:
- Large status badge (use existing status color mapping)
- Vertical timeline from auditLog: icon + action label + timestamp + actor name
- If status = sent_back: red alert banner showing reviewerNote + "Edit Invoice" button

Section 2 — Invoice Info:
- Vendor name, invoice number, invoice date, amount (₹ format), department, bill type, uploaded by + date, reviewed by + date

Section 3 — GRN Table (if grn_bill):
- Columns: GRN Number | Amount | Date | Status (color coded)
- "Add GRN" button — shown only if:
  (user is role_1 AND invoice.uploadedBy = currentUser) OR user is admin
  AND invoice.status not in [reconciled, paid]
- Add GRN inline form (shown below table on button click):
  GRN Number (with real-time duplicate check on blur → GET /grns/check)
  GRN Amount, GRN Date
  Save → POST /invoices/:id/grns
  On success: refetch invoice data

Section 4 — Version History (collapsed by default):
- Toggle "View History"
- Each version: Version # | Amount | Changed by | Date | Reason

Data: useQuery → GET /invoices/:id
Must have: loading skeleton, empty/error states
