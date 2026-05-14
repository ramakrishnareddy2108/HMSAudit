import { api } from '@/lib/api'

// TODO: implement user CRUD with role and department assignment
// Uses GET /users, POST /users, PUT /users/:id, PATCH /users/:id/toggle-active

export default function UserManagementPage() {
  // api.get('/users')
  // api.post('/users', body)
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">User Management</h1>
      <p className="text-muted-foreground">User management — to be implemented.</p>
    </div>
  )
}
