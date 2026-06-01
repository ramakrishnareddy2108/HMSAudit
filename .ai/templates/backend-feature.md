# Backend Feature Template

TASK: [feature name]

TARGET FILE: [apps/api/src/routes/xxx.ts OR apps/api/src/services/xxx.ts]

IMPLEMENT:
[list endpoints or service methods]

RULES:
- Modify existing file only — do not rewrite unchanged routes
- No explanations, no summaries
- Production-ready code only
- All routes need authenticate guard
- Admin routes need requireRole('admin')
- All mutations write to audit_log
- Zod validation on all request bodies
- Pagination on all list endpoints
