# P06a — Review Queue (Backend)

Read CLAUDE.md first.

TARGET: apps/api/src/routes/invoices.ts

Verify/implement these endpoints fully (no stubs):

POST /invoices/:id/approve
- preHandler: [authenticate, requireRole('role_2', 'admin')]
- Validate: status must be pending_review or re_submitted
- Validate: sum of grnEntries.grnAmount <= invoice.invoiceAmount (400 if violated)
- Update: status = approved, reviewedBy = userId, updatedAt
- Write audit_log
- Return updated invoice

POST /invoices/:id/send-back
- preHandler: [authenticate, requireRole('role_2', 'admin')]
- Body: { note: string } — Zod: min 1 char, required
- Validate: status must be pending_review or re_submitted
- Update: status = sent_back, reviewerNote = note, reviewedBy = userId
- Write audit_log
- Return updated invoice

GET /invoices (verify role filtering is correct):
- role_1: filter by uploadedBy.departmentId = user's department
- role_2 and admin: all invoices
- Query params: status (comma-separated), search, dateFrom, dateTo, billType, page, limit, sortBy (default: createdAt desc)
- For review queue use: ?status=pending_review,re_submitted&sortBy=createdAt_asc
