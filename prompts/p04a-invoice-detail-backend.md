# P04a — Invoice Detail (Backend)

Read CLAUDE.md first.

TARGET: apps/api/src/routes/invoices.ts

Add/verify these endpoints are fully implemented (not stubbed):

GET /invoices/:id
- preHandler: [authenticate]
- Return full invoice with: vendor, uploadedByUser, reviewedByUser, grnEntries, invoiceVersions
- Include auditLog entries for this invoiceId ordered by createdAt asc
- role_1: only their own dept invoices (check uploadedBy.departmentId)
- role_2 and admin: any invoice

GET /invoices/:id/versions
- preHandler: [authenticate]
- Return all InvoiceVersion records for this invoice ordered by versionNo asc

GET /invoices/check-duplicate
- preHandler: [authenticate]
- Query params: invoiceNumber (string), vendorId (uuid)
- Return: { exists: boolean, invoice?: { id, invoiceNumber, vendor, uploadedBy, status, grnCount } }

GET /grns/check
- preHandler: [authenticate]
- Query param: grnNumber (string)
- Return: { exists: boolean, entry?: { grnNumber, invoice: { invoiceNumber, vendor, uploadedBy } } }

No explanations. Production-ready only.
