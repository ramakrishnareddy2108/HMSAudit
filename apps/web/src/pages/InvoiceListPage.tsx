import { api } from '@/lib/api'

// TODO: implement paginated invoice list with filters (status, vendor, date range)
// Uses GET /invoices

export default function InvoiceListPage() {
  // api.get('/invoices', { params: { page, limit, status, vendorId } })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Invoices</h1>
      <p className="text-muted-foreground">Invoice list — to be implemented.</p>
    </div>
  )
}
