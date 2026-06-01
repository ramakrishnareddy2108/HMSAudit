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
- Middleware available: `authenticate` (every route), `requireRole('admin' | 'role_2' | 'role_1')`
- role_1 = Department Staff (sees own dept only — enforced on backend)
- role_2 = Reviewer (sees all invoices, manages review queue)
- admin = Full access + reconciliation + payments + management

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

## DB Schema — 16 tables (all pushed to Supabase)
vendors, users, departments, user_departments, invoices, invoice_versions,
grn_entries, grn_master, grn_sync_runs, grn_conflicts,
reconciliation_runs, recon_results, payments, payment_grns,
audit_log, notifications

## Completed Work (Prompts 1–3)
- Monorepo scaffold (pnpm workspaces)
- Prisma schema — all 16 tables pushed
- Environment variables configured
- Auth system — login working, JWT middleware in place
- Seed user: admin@hospital.com / Admin@123456
- Prompt 01: Vendor management — backend routes + frontend VendorManagementPage
- Prompt 02: Invoice list page — InvoiceListPage + InvoiceCard component
- Prompt 03: Add Invoice wizard — 5-step wizard + OCR preview endpoint

## Files Created So Far (key ones)
```
apps/api/src/routes/vendors.ts        GET/POST/PUT/DELETE /vendors
apps/api/src/routes/invoices.ts       POST /invoices, POST /invoices/ocr-preview
apps/api/src/routes/departments.ts    GET/POST/PUT /departments
apps/web/src/pages/admin/VendorManagementPage.tsx
apps/web/src/pages/InvoiceListPage.tsx
apps/web/src/components/invoices/InvoiceCard.tsx
apps/web/src/pages/invoices/AddInvoicePage.tsx
apps/web/src/components/invoices/FileUploadStep.tsx
apps/web/src/components/invoices/InvoiceDetailsStep.tsx
apps/web/src/components/invoices/GrnEntryStep.tsx
apps/web/src/components/invoices/MiscDetailsStep.tsx
apps/web/src/components/invoices/ReviewSubmitStep.tsx
```

## Response Rules
- No explanations unless asked
- No summaries of what you just did
- No TODOs — all code must be complete and production-ready
- Modify existing files — do not rewrite unchanged sections
- Return only changed files and functions
- No preambles like "I'll now implement..."
- Strict TypeScript — no `any` types
