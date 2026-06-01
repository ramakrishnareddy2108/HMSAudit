# P10 — Payment Flow (Admin)

Read CLAUDE.md first.

## Backend

TARGET: apps/api/src/services/emailService.ts (create)

class EmailService:
async sendPaymentEmail(params: { vendorEmail, vendorName, paymentAmount, paymentDate, paymentMode, transactionRef, remarks, grns: { grnNumber, invoiceNumber, amount }[], customBody?: string }): Promise<void>
- Use Resend SDK
- From: "HMS Payments <onboarding@resend.dev>" (dev) — use env var RESEND_FROM for prod
- Default HTML template:
  Dear [vendorName],
  Payment of ₹[amount] confirmed on [date] via [mode]. Ref: [transactionRef].
  [GRN table: grnNumber | invoiceNumber | amount]
  Regards, Hospital Billing Team

generateEmailPreview(params): string — returns HTML string (same template, no send)

TARGET: apps/api/src/routes/payments.ts (create, register at /payments)

GET /payments/eligible-grns
- requireRole('admin')
- Query: vendorId (required), month (required), year (required)
- Return: reconciled unpaid grnEntries grouped by invoice + disputed ones separately
- Return: { grns, disputedGrns, totalAmount, vendor }

POST /payments
- requireRole('admin')
- Body Zod: { vendorId, grnIds: string[], paymentDate, paymentMode, transactionRef?, remarks?, emailBody: string }
- Prisma transaction:
  1. Verify all grnIds are reconciled and not paid
  2. Calculate totalAmount
  3. Create Payment record
  4. Create PaymentGrn rows for each grnId
  5. Update each GrnEntry: status = paid
  6. Check each invoice: if ALL grnEntries paid → invoice.status = paid
  7. Send email via emailService.sendPaymentEmail
  8. Update payment: emailSent=true, emailSentAt
  9. Write audit_log
- Return created payment

GET /payments — requireRole('admin'), query: vendorId, month, year, page, limit
GET /payments/:id — include vendor, paymentGrns with grnEntry and invoice
POST /payments/:id/resend-email — body: { emailBody }, resend + update emailSentAt + audit_log

## Frontend

TARGET: apps/web/src/pages/admin/PaymentsPage.tsx

Section 1 — New Payment:
- Vendor selector (searchable) + Month/Year picker + "Load GRNs" button
- GRN selection table: Checkbox | GRN No. | Invoice No. | Amount | Status
  Disputed GRNs at bottom, unchecked by default, amber row
  Running total: "Selected: ₹45,000 (8 GRNs)"
- Payment details form (alongside table):
  Payment Date (default today) | Payment Mode (NEFT/RTGS/Cheque/Cash) | Transaction Ref | Remarks
- "Preview Email" button → opens email preview modal

Email Preview Modal (shadcn Dialog):
- Rendered HTML preview of email
- Editable textarea below for admin to modify body
- "Confirm & Send Payment" button → POST /payments
- On success: success toast + clear form

Section 2 — Payment History:
Table: Date | Vendor | Amount | Mode | Reference | GRN Count | Email Status | View button
Payment detail Sheet: all payment info + GRN list + "Resend Email" button
