# P12 — Notifications + App Layout + Navigation

Read CLAUDE.md first.

## PART A: Notifications Backend

Add to Prisma schema (apps/api/prisma/schema.prisma):
model Notification {
  id         String   @id @default(uuid())
  userId     String
  title      String
  message    String
  type       String   // invoice_sent_back | invoice_approved | new_review | conflict_found
  entityType String?
  entityId   String?
  isRead     Boolean  @default(false)
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  @@index([userId, isRead])
}
Add notifications relation to User model.
Run: pnpm --filter api db:push

TARGET: apps/api/src/services/notificationService.ts (create)
- create(userId, { title, message, type, entityType?, entityId? })
- notifyInvoiceSentBack(invoiceId, uploaderId, note) — notify uploader
- notifyInvoiceApproved(invoiceId, uploaderId) — notify uploader
- notifyNewReviewItem(invoiceId) — notify ALL role_2 + admin users

Add notification calls in invoices.ts:
- POST /invoices → notifyNewReviewItem
- POST /invoices/:id/approve → notifyInvoiceApproved
- POST /invoices/:id/send-back → notifyInvoiceSentBack

TARGET: apps/api/src/routes/notifications.ts
GET /notifications — authenticate, query: unreadOnly, page, limit(20), ordered createdAt desc
POST /notifications/mark-read — body: { notificationIds: string[] } OR { all: true }
GET /notifications/unread-count — returns { count: number }

## PART B: App Layout + Navigation

TARGET: apps/web/src/components/layout/AppLayout.tsx

Sidebar navigation — role-based:
role_1:  My Invoices (/invoices) | New Invoice (/invoices/new)
role_2:  Review Queue (/review) | All Invoices (/invoices) | Reviewed History (/review/history)
admin:   Dashboard | All Invoices | Review Queue | GRN Sync | Reconciliation |
         Payments | Vendor Ledger | Vendors | Users | Departments | Reports

Notification bell (top right header):
- GET /notifications/unread-count every 30s
- Red badge if count > 0
- Click → dropdown (last 10 notifications):
  Icon by type | Title (bold if unread) | Message | Time ago
  Click item: mark read + navigate to /invoices/:entityId
  "Mark all read" button → POST /notifications/mark-read { all: true }
  "View all" link → /notifications

TARGET: apps/web/src/pages/NotificationsPage.tsx
Full list, filter All/Unread, mark all read button.

## PART C: Missing Small Pages

apps/web/src/pages/ForgotPasswordPage.tsx — email input → POST /auth/forgot-password → success message
apps/web/src/pages/NotFoundPage.tsx — "Page not found" + back home button
Add auth loading screen in root to prevent login flash on refresh.
