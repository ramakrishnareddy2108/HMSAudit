import { api } from '@/lib/api'

// TODO: implement GRN Excel upload, sync run history, and conflict resolution UI
// Uses POST /grn-sync/upload, GET /grn-sync/runs, GET /grn-sync/runs/:id/conflicts
// POST /grn-sync/runs/:id/conflicts/:conflictId/resolve

export default function GrnSyncPage() {
  // api.post('/grn-sync/upload', formData)
  // api.get('/grn-sync/runs')
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">GRN Sync</h1>
      <p className="text-muted-foreground">GRN sync upload and conflict resolution — to be implemented.</p>
    </div>
  )
}
