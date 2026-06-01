# P13 — Final Polish + Production Deploy

Read CLAUDE.md first.

## PART A: Verification Pass

Scan apps/api/src/routes/ — fix anything that is:
- Missing authenticate/requireRole guard
- Missing audit_log write on mutation
- Returning stub/todo response
- Missing Zod validation
- List endpoint without pagination
- role_1 department isolation missing on GET /invoices

Scan apps/web/src/pages/ — fix anything that is:
- Stub page (just a heading)
- Missing loading skeleton
- Missing empty state
- Missing error state

## PART B: Performance

Add missing DB indexes to apps/api/prisma/schema.prisma if not present:
@@index([invoiceDate]) on Invoice
@@index([status]) on GrnEntry
@@index([createdAt]) on Payment
@@index([entityType, entityId]) on AuditLog
Run: pnpm --filter api db:push

GET /invoices list query: use Prisma select to exclude ocrRawData field.

## PART C: Production Files

Create apps/api/Dockerfile:
FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
WORKDIR /app/apps/api
RUN pnpm prisma generate
RUN pnpm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]

Create railway.json at root:
{ "build": { "builder": "DOCKERFILE", "dockerfilePath": "apps/api/Dockerfile" }, "deploy": { "healthcheckPath": "/health" } }

Create apps/web/vercel.json:
{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }

## PART D: Final Checks
Run: pnpm typecheck
Run: pnpm --filter api build
Run: pnpm --filter web build
Fix ALL TypeScript and build errors.

## PART E: Report
After completing, provide:
1. All pages with their routes
2. All API endpoints implemented
3. Any known limitations
4. Estimated effort to add React Native mobile app
