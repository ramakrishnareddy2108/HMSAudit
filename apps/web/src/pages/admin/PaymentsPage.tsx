import { api } from '@/lib/api'

// TODO: implement payment creation (pick eligible GRNs → record payment → send email)
// Uses GET /payments/eligible-grns, POST /payments, GET /payments, GET /payments/:id
// POST /payments/:id/resend-email

export default function PaymentsPage() {
  // api.get('/payments/eligible-grns', { params: { vendorId, periodMonth, periodYear } })
  // api.post('/payments', body)
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Payments</h1>
      <p className="text-muted-foreground">Payment management — to be implemented.</p>
    </div>
  )
}
