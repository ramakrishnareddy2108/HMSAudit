# HMS Invoice Tracker — Project Context

## What This Is
Hospital Vendor Invoice & GRN Tracking System.
Multi-role web app: Role-1 (staff) uploads invoices → Role-2 (reviewer) approves → Admin reconciles against GRN Excel + marks payments.

## Monorepo Structure
```
apps/api/          Fastify + Prisma + Node.js 20 LTS
apps/web/          React 18 + Vite + shadcn/ui + Tailwind
packages/shared/   Shared TypeScript types and enums
```

## Stack — Do NOT suggest alternatives
| Layer | Technology |
|---|---|
| Backend | Fastify, Prisma, Node.js 20 |
| Database / Auth / Storage | Supabase (PostgreSQL + Auth + Storage) |
| Job Queue | BullMQ + Upstash Redis |
| OCR | Google Cloud Vision API |
| Email | Resend.com |
| Frontend | React 18, Vite, shadcn/ui, Tailwind, TanStack Query, TanStack Table, Zustand, React Hook Form + Zod |
| Hosting | Railway (API) + Vercel (web) |

## Auth
- Supabase Auth — JWT tokens
- Middleware available: `authenticate`, `requireRole('admin' | 'role_2' | 'role_1')`, `requireSuperAdmin`
- super_admin = isSuperAdmin=true in DB (no Role enum change) — manages all hospitals
- role_1 = Department Staff (sees own dept only — enforced on backend)
- role_2 = Reviewer (sees all invoices for their hospital, manages review queue)
- admin = Hospital admin — full access + reconciliation + payments + management for their hospital

## Multi-Hospital Architecture
- Tenancy middleware: AsyncLocalStorage + Prisma $use intercepts all queries
- authenticate middleware sets `request.user.activeHospitalId` and calls `tenantStorage.enterWith()`
- Super admin with `X-Hospital-Id` header → uses that hospital's data context
- Super admin with no header → sees all data (no filter applied)
- Hospital admin / staff / reviewer → always filtered to their own hospitalId
- Non-tenant models: Hospital, User (User filtering done manually in routes)

## Business Rules — NEVER violate
1. GRN number is GLOBALLY unique — hard block on duplicate
2. Sum of GRN amounts must always be ≤ invoice total amount
3. Price revision → reset to pending_review + archive old version + set isPriceRevised flag
4. Misc bills skip reconciliation entirely but go through review workflow
5. Reconciliation match key = Vendor + Invoice Number + GRN Number (all 3 must match)
6. Only reconciled GRNs are eligible for payment
7. Paid and reconciled GRNs are LOCKED — no edits ever

## Invoice Status Flow
```
draft → pending_review → approved → reconciled → paid
                      ↕
               sent_back → re_submitted → pending_review
```

## Existing Patterns — Always reuse
- React Query (`useQuery`, `useMutation`) for all server state
- React Hook Form + Zod for all forms
- shadcn `Dialog` for modals, `Sheet` for side drawers
- `sonner` for toast notifications
- TanStack Table for all data tables
- Prisma transactions for multi-step mutations
- `audit_log` write on every POST / PUT / DELETE
- Indian currency format: `₹1,23,456` via `toLocaleString('en-IN')`

## DB Schema — 17 tables (all pushed to Supabase)
hospitals, vendors, users, departments, user_departments, invoices, invoice_versions,
grn_entries, grn_master, grn_sync_runs, grn_conflicts,
reconciliation_runs, recon_results, payments, payment_grns,
audit_log, notifications

## Completed Work (Prompts 1–4)
- Monorepo scaffold (pnpm workspaces)
- Prisma schema — all 17 tables pushed
- Environment variables configured
- Auth system — login working, JWT middleware in place
- Prompt 01: Vendor management — backend routes + frontend VendorManagementPage
- Prompt 02: Invoice list page — InvoiceListPage + InvoiceCard component
- Prompt 03: Add Invoice wizard — 5-step wizard + OCR preview endpoint
- Prompt 04: Multi-hospital support
  - Hospital model + hospitalId on all tenant-scoped tables
  - isSuperAdmin boolean on User (no enum change)
  - Tenancy middleware (AsyncLocalStorage + Prisma $use)
  - Super admin routes: GET/POST/PUT /super/hospitals, POST /super/hospitals/:id/admin, GET /super/hospitals/:id/users, GET /super/monthly-status
  - Hospital switcher in AppLayout top nav
  - Dynamic sidebar nav based on role + hospital selection
  - MyDashboardPage (/super/dashboard) — monthly status overview
  - HospitalsPage (/super/hospitals) — manage hospitals + admins + users
  - Route guards: /super/* require isSuperAdmin, /admin/* require hospital selection for super admin

## Seed Credentials (after DB reset + seed)
- superadmin@hms.com / SuperAdmin@123  (super admin)
- admin@cityhospital.com / Admin@123456  (City Hospital admin)
- admin@generalhospital.com / Admin@123456  (General Hospital admin)
- reviewer@cityhospital.com / Reviewer@123456  (City Hospital reviewer)
- staff.pharmacy@cityhospital.com / Staff@123456  (City Hospital staff)
- staff.icu@cityhospital.com / Staff@123456  (City Hospital staff)

## Files Created So Far (key ones)
```
apps/api/src/routes/vendors.ts            GET/POST/PUT/DELETE /vendors
apps/api/src/routes/invoices.ts           POST /invoices, POST /invoices/ocr-preview
apps/api/src/routes/departments.ts        GET/POST/PUT /departments
apps/api/src/routes/superAdmin.ts         GET/POST/PUT /super/hospitals, /super/monthly-status
apps/api/src/middleware/tenancy.ts        AsyncLocalStorage + Prisma $use tenancy middleware
apps/web/src/pages/admin/VendorManagementPage.tsx
apps/web/src/pages/InvoiceListPage.tsx
apps/web/src/components/invoices/InvoiceCard.tsx
apps/web/src/pages/invoices/AddInvoicePage.tsx
apps/web/src/components/invoices/FileUploadStep.tsx
apps/web/src/components/invoices/InvoiceDetailsStep.tsx
apps/web/src/components/invoices/GrnEntryStep.tsx
apps/web/src/components/invoices/MiscDetailsStep.tsx
apps/web/src/components/invoices/ReviewSubmitStep.tsx
apps/web/src/pages/super/MyDashboardPage.tsx
apps/web/src/pages/super/HospitalsPage.tsx
apps/web/src/components/ui/sheet.tsx
```

## Storage
- Cloudflare R2 (private bucket, presigned URLs 15 min expiry)
- `apps/api/src/services/storageService.ts`
- Images compressed: 1200px max, JPEG 85% via sharp

## Caching
- `apps/api/src/services/cacheService.ts` (in-memory Map, 7-day TTL)
- Cached: vendors, departments, users per hospitalId
- Invalidated on any mutation (deleteByPrefix)
- Frontend staleTime: 7 days on vendors, departments, users queries

## Disabled Features
- Audit log: **DISABLED** (`AUDIT_LOG_ENABLED = false` in `apps/api/src/constants.ts`)
- Re-enable: set flag to `true`

## API Docs
- Swagger UI: `http://localhost:3001/docs` (dev only, `NODE_ENV !== 'production'`)
- All route groups tagged: Auth, Vendors, Invoices, Departments, GRN Sync, Reconciliation, Payments, Notifications, Reports, Super Admin, Users, System

## TypeScript Notes
- Tenancy middleware injects `hospitalId` via Prisma `$use` at runtime
- All tenant-scoped `.create()` calls use `as unknown as Prisma.XUncheckedCreateInput` cast
- ReconciliationService explicitly passes `hospitalId` since it's available as a parameter

## New Pages / Endpoints
- `GET /super/db-stats` — PostgreSQL table sizes + row counts (super admin only)
- `apps/web/src/pages/ErrorPage.tsx`
- `apps/web/src/pages/ReviewHistoryPage.tsx`
- `apps/web/src/pages/super/` — MyDashboardPage now includes DB usage section

## Response Rules
- No explanations unless asked
- No summaries of what you just did
- No TODOs — all code must be complete and production-ready
- Modify existing files — do not rewrite unchanged sections
- Return only changed files and functions
- No preambles like "I'll now implement..."
- Strict TypeScript — no `any` types
