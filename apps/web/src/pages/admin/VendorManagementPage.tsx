import { api } from '@/lib/api'

// TODO: implement vendor CRUD (list, create, edit, toggle active)
// Uses GET /vendors, POST /vendors, PUT /vendors/:id, PATCH /vendors/:id/toggle-active

export default function VendorManagementPage() {
  // api.get('/vendors')
  // api.post('/vendors', body)
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Vendor Management</h1>
      <p className="text-muted-foreground">Vendor management — to be implemented.</p>
    </div>
  )
}
