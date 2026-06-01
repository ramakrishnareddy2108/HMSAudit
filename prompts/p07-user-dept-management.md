# P07 — User + Department Management

Read CLAUDE.md first.

## PART A: Departments Backend
TARGET: apps/api/src/routes/departments.ts

Verify all implemented (no stubs):
GET /departments — preHandler: [authenticate], all roles, query: isActive (default true)
POST /departments — requireRole('admin'), body: { name }, check unique name
PUT /departments/:id — requireRole('admin'), body: { name?, isActive? }
All mutations write audit_log.

## PART B: Users Backend
TARGET: apps/api/src/routes/users.ts

Implement fully:

GET /users
- requireRole('admin')
- Query: role, isActive, search (name or email), page, limit
- Include departments for role_1 users

POST /users/invite
- requireRole('admin')
- Body: { name, email, role, departmentIds?: string[] }
- Create user in Supabase Auth via supabase.auth.admin.inviteUserByEmail
- Create user record in DB with role and isActive=true
- If role=role_1 and departmentIds: insert UserDepartment rows
- Write audit_log
- Return created user

PUT /users/:id
- requireRole('admin')
- Body: { name?, role?, isActive?, departmentIds? }
- If departmentIds: delete existing UserDepartment rows, insert new ones
- Write audit_log

DELETE /users/:id (soft delete)
- requireRole('admin')
- Block if userId = request.user.id (cannot deactivate yourself)
- Set isActive = false
- Write audit_log

## PART C: Frontend
TARGET: apps/web/src/pages/admin/UserManagementPage.tsx

TanStack Table: Name | Email | Role badge | Departments | Status | Actions (Edit / Deactivate)
Role badges: role_1=gray "Staff", role_2=blue "Reviewer", admin=purple "Admin"

Invite User Modal (shadcn Dialog):
- Name, Email, Role (radio: Staff/Reviewer/Admin)
- Departments: multi-select checkboxes (only if role=Staff) from GET /departments
- On success: "Invite sent to [email]" toast

Edit User Modal: same fields pre-filled, cannot change own role.

TARGET: apps/web/src/pages/admin/DepartmentManagementPage.tsx
Simple table: Name | Status | Actions (Edit / Toggle Active)
Add Department modal with single name field.
Route: /admin/departments
