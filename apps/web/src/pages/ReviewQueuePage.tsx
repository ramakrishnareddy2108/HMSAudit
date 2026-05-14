import { api } from '@/lib/api'

// TODO: implement review queue showing pending_review and re_submitted invoices
// Uses GET /invoices?status=pending_review

export default function ReviewQueuePage() {
  // api.get('/invoices', { params: { status: 'pending_review' } })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Review Queue</h1>
      <p className="text-muted-foreground">Review queue — to be implemented.</p>
    </div>
  )
}
