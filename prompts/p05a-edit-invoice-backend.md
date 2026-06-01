# P05a — Edit Invoice + OCR Preview (Backend)

Read CLAUDE.md first.

TARGET: apps/api/src/routes/invoices.ts

Verify/implement PUT /invoices/:id fully:
- preHandler: [authenticate]
- role_1: only own invoices; admin: any invoice
- Block if status = reconciled or paid (return 400)
- Block edit on any grnEntry that has status = paid or reconciled
- Before update: create InvoiceVersion record with current file_url, invoice_amount, changed_by, change_reason, version_no = current + 1
- If invoice_amount changed: set isPriceRevised = true
- Always reset status to pending_review after edit
- Write audit_log with oldValue and newValue
- Return updated invoice

Implement POST /invoices/:id/grns:
- preHandler: [authenticate]
- Body: { grnNumber, grnAmount, grnDate }
- Check grnNumber global uniqueness — 409 if exists
- Check new grnTotal <= invoice.invoiceAmount — 400 if exceeded
- Create GrnEntry record
- Write audit_log
- Return created grn entry

Implement DELETE /invoices/:id/grns/:grnId:
- preHandler: [authenticate]
- Block if grn status = paid or reconciled
- Soft approach: delete the record (grn_entries can be hard deleted if not locked)
- Write audit_log

Also implement POST /invoices/ocr-preview if not done in Prompt 03:
- preHandler: [authenticate]
- Accept multipart with one file
- Upload to Supabase Storage at path: ocr-preview/{userId}/{timestamp}
- Call ocrService.extractFromUrl(fileUrl)
- Return OCR fields with confidence scores — do NOT create any invoice record
