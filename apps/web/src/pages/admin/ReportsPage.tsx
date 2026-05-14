import { api } from '@/lib/api'

// TODO: implement reports page with period selector, summary tables, and Excel export
// Uses GET /reports/invoice-summary, GET /reports/reconciliation-summary
// GET /reports/export/invoices

export default function ReportsPage() {
  // api.get('/reports/invoice-summary', { params: { periodMonth, periodYear } })
  // api.get('/reports/export/invoices', { responseType: 'blob' })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports</h1>
      <p className="text-muted-foreground">Reports and export — to be implemented.</p>
    </div>
  )
}
