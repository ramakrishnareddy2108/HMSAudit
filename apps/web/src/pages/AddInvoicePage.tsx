import { api } from '@/lib/api'

// TODO: implement invoice upload form with multipart support, OCR status polling
// Uses POST /invoices (multipart)

export default function AddInvoicePage() {
  // api.post('/invoices', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Add Invoice</h1>
      <p className="text-muted-foreground">Add invoice form — to be implemented.</p>
    </div>
  )
}
