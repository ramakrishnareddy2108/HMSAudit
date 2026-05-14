import { api } from '@/lib/api'
import { useParams } from 'react-router-dom'

// TODO: implement invoice edit form, pre-populated from existing data
// Uses PUT /invoices/:id

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>()

  // api.put(`/invoices/${id}`, body)
  void api
  void id

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Invoice</h1>
      <p className="text-muted-foreground">Edit invoice form — to be implemented.</p>
    </div>
  )
}
