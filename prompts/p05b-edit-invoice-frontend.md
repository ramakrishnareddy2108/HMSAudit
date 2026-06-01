# P05b — Edit Invoice Page (Frontend)

Read CLAUDE.md first.

TARGET: apps/web/src/pages/invoices/EditInvoicePage.tsx

Route: /invoices/:id/edit?mode=correction OR ?mode=revision

CORRECTION MODE (mode=correction, came from sent_back):
- Red banner at top: "Reviewer note: [reviewerNote]"
- Editable: invoice image (optional re-upload), invoice amount, GRN entries not in paid/reconciled status
- Locked GRNs shown as read-only rows with lock icon
- Submit button: "Re-submit for Review"
- On submit: PUT /invoices/:id → navigate to /invoices/:id

REVISION MODE (mode=revision, price renegotiation):
- Show confirmation dialog FIRST before showing form:
  "Update Invoice? This will reset status to Pending Review. The reviewer will be notified."
  [Cancel] [Proceed]
- If cancelled: go back (useNavigate(-1))
- If proceeded: show edit form
- Editable: invoice image (optional), invoice amount only
- GRNs shown as read-only
- Required field: "Reason for revision" textarea
- Submit button: "Submit Price Revision"

Both modes:
- File upload zone with current image shown alongside
- Running total validation: grnTotal <= invoiceAmount — disable submit if violated
- On success: navigate to /invoices/:id with success toast

useMutation → PUT /invoices/:id
