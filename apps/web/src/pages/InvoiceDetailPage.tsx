import { api } from '@/lib/api'
import { useParams } from 'react-router-dom'

// TODO: implement full invoice detail view with GRN list, OCR result, version history
// Uses GET /invoices/:id and GET /invoices/:id/versions

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()

  // api.get(`/invoices/${id}`)
  // api.get(`/invoices/${id}/versions`)
  void api
  void id

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Invoice Detail</h1>
      <p className="text-muted-foreground">Invoice detail view — to be implemented.</p>
    </div>
  )
}
