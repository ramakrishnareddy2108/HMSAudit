import { api } from '@/lib/api'

// TODO: implement admin dashboard with KPI cards and charts (Recharts)
// Uses GET /reports/invoice-summary, GET /reports/vendor-payments

export default function DashboardPage() {
  // api.get('/reports/invoice-summary', { params: { periodMonth, periodYear } })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <p className="text-muted-foreground">Admin dashboard — to be implemented.</p>
    </div>
  )
}
