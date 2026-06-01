# Claude Code Rules — HMS Invoice Tracker

## Response Behavior
- No explanations unless explicitly asked
- No summaries or "here's what I did" after completing
- No preambles — start coding immediately
- Return only modified files and changed functions
- Minimal diffs — never regenerate unchanged code sections
- No TODO comments — every line must be complete working code
- No placeholder functions like `// implement later`

## Backend Rules (apps/api)
- Every route must have `preHandler: [authenticate]`
- Admin-only routes must also have `requireRole('admin')`
- Every POST / PUT / DELETE must write to `audit_log`
- Multi-step mutations must use Prisma transactions
- All request bodies validated with Zod schemas
- Business logic goes in `src/services/` — keep route handlers thin
- All list endpoints must have pagination (page + limit params)
- List queries must use Prisma `select` — exclude `ocrRawData`, large JSON fields
- Errors must be structured: `{ statusCode, error, message }`
- Never hard-delete — always soft delete or status change

## Frontend Rules (apps/web)
- React Query for all server state — no direct fetch in components
- React Hook Form + Zod for all forms — no uncontrolled inputs
- shadcn `Dialog` for modals, `Sheet` for drawers
- `sonner` for all toast notifications
- TanStack Table for all data tables with filtering + sorting
- Every page must have: loading skeleton, empty state, error state
- Indian currency format everywhere: `amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })`
- All components must be responsive (mobile + desktop)
- Status badges use consistent colors:
  pending_review=yellow, sent_back=red, re_submitted=blue,
  approved=green, reconciled=indigo, paid=emerald

## TypeScript Rules
- Strict mode — zero `any` types
- Import types from `packages/shared` whenever they exist
- No implicit returns in async functions
- Enum values from shared package — no magic strings

## What Not To Do
- Do not suggest alternative libraries or stack changes
- Do not rewrite files that have no changes needed
- Do not add console.log statements
- Do not generate mock/demo data
- Do not add comments explaining obvious code
- Do not introduce new npm packages without being asked
