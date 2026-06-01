# Backend Completion Checklist

Before marking any backend prompt done, verify:

- [ ] All routes have `preHandler: [authenticate]`
- [ ] Admin-only routes have `requireRole('admin')`
- [ ] Every POST/PUT/DELETE writes to audit_log
- [ ] Multi-step mutations use Prisma transactions
- [ ] All request bodies have Zod validation schemas
- [ ] All list endpoints have pagination (page, limit)
- [ ] List queries use `select` to exclude heavy fields
- [ ] Error responses are structured `{ statusCode, error, message }`
- [ ] No route returns stub/todo response
- [ ] TypeScript strict — no `any` types
- [ ] Business logic is in services/, not in route handlers
