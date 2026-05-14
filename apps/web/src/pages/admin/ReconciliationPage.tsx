import { api } from '@/lib/api'

// TODO: implement reconciliation run trigger, results table, and resolution UI
// Uses POST /reconciliation/run, GET /reconciliation/runs,
// GET /reconciliation/runs/:id/results, POST /reconciliation/runs/:id/results/:resultId/resolve

export default function ReconciliationPage() {
  // api.post('/reconciliation/run', { periodMonth, periodYear })
  // api.get('/reconciliation/runs')
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reconciliation</h1>
      <p className="text-muted-foreground">Reconciliation runs and results — to be implemented.</p>
    </div>
  )
}
