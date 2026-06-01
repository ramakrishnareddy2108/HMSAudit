# P06b — Review Queue + Review Detail (Frontend)

Read CLAUDE.md first.

## FILE 1: apps/web/src/pages/ReviewQueuePage.tsx
Default landing page for role_2.

Layout:
- Header: "Review Queue" + count badge (total pending)
- Filter bar: Department | Vendor | Date range | Bill type | Reset
- Sort toggle: Oldest first (default) / Newest first
- List of ReviewQueueCard components

ReviewQueueCard (apps/web/src/components/review/ReviewQueueCard.tsx):
- Tags: "NEW" (blue) if first submission | "RESUBMITTED" (orange) if re_submitted | "PRICE REVISED" (purple) if isPriceRevised
- Invoice number | Vendor | Department
- Amount | GRN count | Uploaded by | Date
- If isPriceRevised: show "₹45,000 → ₹42,000" diff line
- "Review →" button → /review/:id

Data: useQuery → GET /invoices?status=pending_review,re_submitted
Auto-refresh every 30 seconds (refetchInterval: 30000)
Loading: skeleton cards | Empty: "No invoices pending review" | Error: error message

---

## FILE 2: apps/web/src/pages/ReviewDetailPage.tsx
Route: /review/:id

Desktop: 55% left image / 45% right data. Mobile: tabs (Image | Details).

LEFT — Image Viewer:
- Same viewer component as InvoiceDetailPage (reuse it)
- If isPriceRevised + multiple versions: toggle "Previous Version" / "Current Version"
- Price change alert if revised: "Amount changed from ₹X to ₹Y by [name] on [date]"

RIGHT — Invoice Data:
- All invoice fields (read-only)
- GRN table with amounts
- GRN total row:
  grnTotal = invoiceAmount → green "✓ GRN total matches invoice amount"
  grnTotal < invoiceAmount → amber "GRN total ₹X is less than invoice ₹Y"
  grnTotal > invoiceAmount → red "✗ GRN total exceeds invoice — cannot approve"
- If re_submitted: amber box "Previous reviewer note: [original note]"

Sticky action section at bottom:
SEND BACK button → opens Sheet drawer:
  Textarea "Note for department staff" (required, min 10 chars, char count shown)
  "Send Back" confirm → POST /invoices/:id/send-back
  On success: navigate to /review + toast

APPROVE button:
  Disabled if grnTotal > invoiceAmount (tooltip: "GRN total exceeds invoice amount")
  On click: confirmation dialog "Approve this invoice?"
  On confirm: POST /invoices/:id/approve → navigate to /review + toast
