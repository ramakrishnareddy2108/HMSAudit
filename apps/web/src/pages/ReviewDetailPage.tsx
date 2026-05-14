import { api } from '@/lib/api'
import { useParams } from 'react-router-dom'

// TODO: implement review detail with approve / send-back actions
// Uses GET /invoices/:id, POST /invoices/:id/approve, POST /invoices/:id/send-back

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>()

  // api.get(`/invoices/${id}`)
  // api.post(`/invoices/${id}/approve`, { note })
  // api.post(`/invoices/${id}/send-back`, { reason })
  void api
  void id

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Review Invoice</h1>
      <p className="text-muted-foreground">Review detail view — to be implemented.</p>
    </div>
  )
}
