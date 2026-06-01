import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Runner {
  id: string
  name: string
  email: string
}

interface SyncRun {
  id: string
  runBy: string
  fileUrl: string | null
  totalRows: number
  inserted: number
  skipped: number
  conflicts: number
  status: 'processing' | 'completed' | 'has_conflicts'
  createdAt: string
  runner: Runner
}

interface SyncRunsResponse {
  data: SyncRun[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface GrnConflict {
  id: string
  syncRunId: string
  grnNumber: string
  systemAmount: number | string
  excelAmount: number | string
  resolution: string | null
  adminNote: string | null
  resolvedAt: string | null
}

interface ConflictsResponse {
  syncRunId: string
  conflicts: GrnConflict[]
  resolvedCount: number
  totalCount: number
}

interface UploadResult {
  syncRunId: string
  inserted: number
  skipped: number
  conflicts: number
  status: 'completed' | 'has_conflicts'
}

type ApiError = { response?: { data?: { error?: string } } }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | string | null): string {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusBadge(status: SyncRun['status']) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Completed</Badge>
    case 'has_conflicts':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">Has Conflicts</Badge>
    default:
      return <Badge variant="secondary">Processing</Badge>
  }
}

// ── Conflict Card ─────────────────────────────────────────────────────────────

interface ConflictCardProps {
  conflict: GrnConflict
  adminNote: string
  onNoteChange: (note: string) => void
  onResolve: (resolution: 'keep_system' | 'use_excel') => void
  isPending: boolean
}

function ConflictCard({ conflict, adminNote, onNoteChange, onResolve, isPending }: ConflictCardProps) {
  const diff = Math.abs(Number(conflict.systemAmount) - Number(conflict.excelAmount))
  const canResolve = adminNote.trim().length > 0

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-sm font-medium">{conflict.grnNumber}</p>
        <div className="flex gap-6 text-sm text-right shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">System</p>
            <p className="font-medium tabular-nums">{fmt(conflict.systemAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Excel</p>
            <p className="font-medium tabular-nums">{fmt(conflict.excelAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className="font-medium tabular-nums text-destructive">{fmt(diff)}</p>
          </div>
        </div>
      </div>

      <Textarea
        value={adminNote}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Admin note (required before resolving)"
        rows={2}
        className="text-sm"
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !canResolve}
          onClick={() => onResolve('keep_system')}
        >
          Keep System ({fmt(conflict.systemAmount)})
        </Button>
        <Button
          size="sm"
          disabled={isPending || !canResolve}
          onClick={() => onResolve('use_excel')}
        >
          Use Excel ({fmt(conflict.excelAmount)})
        </Button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GrnSyncPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [activeConflictRunId, setActiveConflictRunId] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({})

  const runsQuery = useQuery<SyncRunsResponse>({
    queryKey: ['grn-sync-runs'],
    queryFn: () => api.get('/grn-sync/runs', { params: { limit: 50 } }).then((r) => r.data),
  })

  const conflictsQuery = useQuery<ConflictsResponse>({
    queryKey: ['grn-sync-conflicts', activeConflictRunId],
    queryFn: () =>
      api.get(`/grn-sync/runs/${activeConflictRunId}/conflicts`).then((r) => r.data),
    enabled: Boolean(activeConflictRunId),
  })

  useEffect(() => {
    if (activeConflictRunId !== null) return
    const conflictRun = runsQuery.data?.data.find((r) => r.status === 'has_conflicts')
    if (conflictRun) setActiveConflictRunId(conflictRun.id)
  }, [runsQuery.data, activeConflictRunId])

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return api
        .post<UploadResult>('/grn-sync/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data)
    },
    onSuccess: (result) => {
      setUploadResult(result)
      setSelectedFile(null)
      queryClient.invalidateQueries({ queryKey: ['grn-sync-runs'] })
      if (result.conflicts > 0) {
        setActiveConflictRunId(result.syncRunId)
        toast.warning(`Sync complete — ${result.conflicts} conflicts need resolution`)
      } else {
        toast.success(`Sync complete — ${result.inserted} added, ${result.skipped} skipped`)
      }
    },
    onError: (err: unknown) => {
      toast.error((err as ApiError).response?.data?.error ?? 'Upload failed')
    },
  })

  const resolveMutation = useMutation({
    mutationFn: ({
      runId,
      conflictId,
      resolution,
      adminNote,
    }: {
      runId: string
      conflictId: string
      resolution: 'keep_system' | 'use_excel'
      adminNote: string
    }) =>
      api
        .post(`/grn-sync/runs/${runId}/conflicts/${conflictId}/resolve`, { resolution, adminNote })
        .then((r) => r.data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['grn-sync-conflicts', vars.runId] })
      queryClient.invalidateQueries({ queryKey: ['grn-sync-runs'] })
      setAdminNotes((prev) => {
        const n = { ...prev }
        delete n[vars.conflictId]
        return n
      })
      toast.success('Conflict resolved')
    },
    onError: (err: unknown) => {
      toast.error((err as ApiError).response?.data?.error ?? 'Failed to resolve conflict')
    },
  })

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback(() => setIsDragging(false), [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      toast.error('Only .xlsx and .xls files are accepted')
      return
    }
    setSelectedFile(file)
    setUploadResult(null)
  }, [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setUploadResult(null)
    e.target.value = ''
  }, [])

  const runsColumns: ColumnDef<SyncRun>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ getValue }) =>
        format(new Date(getValue() as string), 'dd MMM yyyy, HH:mm'),
    },
    {
      id: 'uploadedBy',
      header: 'Uploaded by',
      cell: ({ row }) => row.original.runner?.name ?? '—',
    },
    {
      accessorKey: 'inserted',
      header: 'Inserted',
      cell: ({ getValue }) => (
        <span className="tabular-nums text-green-700 font-medium">{getValue() as number}</span>
      ),
    },
    {
      accessorKey: 'skipped',
      header: 'Skipped',
      cell: ({ getValue }) => (
        <span className="tabular-nums text-muted-foreground">{getValue() as number}</span>
      ),
    },
    {
      accessorKey: 'conflicts',
      header: 'Conflicts',
      cell: ({ getValue }) => {
        const n = getValue() as number
        return (
          <span className={cn('tabular-nums font-medium', n > 0 ? 'text-amber-700' : 'text-muted-foreground')}>
            {n}
          </span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => statusBadge(getValue() as SyncRun['status']),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        if (row.original.status !== 'has_conflicts') return null
        const isActive = row.original.id === activeConflictRunId
        return (
          <Button
            size="sm"
            variant={isActive ? 'secondary' : 'outline'}
            onClick={() => setActiveConflictRunId(row.original.id)}
          >
            {isActive ? 'Viewing' : 'View Conflicts'}
          </Button>
        )
      },
    },
  ]

  const table = useReactTable({
    data: runsQuery.data?.data ?? [],
    columns: runsColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const lastRun = runsQuery.data?.data[0]
  const activeConflictRun = runsQuery.data?.data.find((r) => r.id === activeConflictRunId)
  const conflictData = conflictsQuery.data

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">GRN Sync</h1>

      {/* ── Upload Panel ── */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold">Upload GRN Excel</h2>
          {lastRun && (
            <p className="text-xs text-muted-foreground">
              Last synced:{' '}
              <span className="text-foreground font-medium">
                {format(new Date(lastRun.createdAt), 'dd MMM yyyy')}
              </span>{' '}
              by <span className="text-foreground font-medium">{lastRun.runner?.name ?? '—'}</span>{' '}
              ({lastRun.totalRows} records)
            </p>
          )}
        </div>

        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors select-none',
            isDragging
              ? 'border-primary bg-primary/5'
              : selectedFile
                ? 'border-green-500 bg-green-50/60'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
          {selectedFile ? (
            <>
              <FileSpreadsheet size={32} className="text-green-600" />
              <div className="text-center">
                <p className="text-sm font-medium text-green-700">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                </p>
              </div>
            </>
          ) : (
            <>
              <Upload size={32} className="text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drag & drop your Excel file here</p>
                <p className="text-xs text-muted-foreground mt-0.5">or click to browse · .xlsx, .xls only</p>
              </div>
            </>
          )}
        </div>

        <Button
          disabled={!selectedFile || uploadMutation.isPending}
          onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
        >
          {uploadMutation.isPending ? (
            <>
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Processing…
            </>
          ) : (
            <>
              <Upload size={16} className="mr-2" />
              Upload & Sync
            </>
          )}
        </Button>

        {uploadResult && (
          <div className="flex flex-wrap gap-4 text-sm pt-1">
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 size={14} />
              {uploadResult.inserted} added
            </span>
            <span className="flex items-center gap-1.5 text-blue-600">
              <CheckCircle2 size={14} />
              {uploadResult.skipped} skipped
            </span>
            {uploadResult.conflicts > 0 && (
              <span className="flex items-center gap-1.5 text-amber-700 font-medium">
                <AlertTriangle size={14} />
                {uploadResult.conflicts} conflicts
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Conflicts Panel ── */}
      {activeConflictRunId && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-base font-semibold">Conflict Resolution</h2>
              {activeConflictRun && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Run from {format(new Date(activeConflictRun.createdAt), 'dd MMM yyyy, HH:mm')}
                </p>
              )}
            </div>
            {conflictData && (
              <p className="text-sm text-muted-foreground">
                {conflictData.resolvedCount} of {conflictData.totalCount} resolved
              </p>
            )}
          </div>

          {conflictData && conflictData.resolvedCount < conflictData.totalCount && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <AlertTriangle size={16} className="shrink-0" />
              {conflictData.totalCount - conflictData.resolvedCount} conflict
              {conflictData.totalCount - conflictData.resolvedCount !== 1 ? 's' : ''} require resolution before reconciliation
            </div>
          )}

          {conflictData && conflictData.resolvedCount === conflictData.totalCount && conflictData.totalCount > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 size={16} className="shrink-0" />
              All conflicts resolved — ready to reconcile
            </div>
          )}

          {conflictsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading conflicts…</p>
          ) : conflictData?.conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No unresolved conflicts.</p>
          ) : (
            <div className="space-y-3">
              {conflictData?.conflicts.map((conflict) => (
                <ConflictCard
                  key={conflict.id}
                  conflict={conflict}
                  adminNote={adminNotes[conflict.id] ?? ''}
                  onNoteChange={(note) =>
                    setAdminNotes((prev) => ({ ...prev, [conflict.id]: note }))
                  }
                  onResolve={(resolution) =>
                    resolveMutation.mutate({
                      runId: activeConflictRunId,
                      conflictId: conflict.id,
                      resolution,
                      adminNote: adminNotes[conflict.id] ?? '',
                    })
                  }
                  isPending={resolveMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sync History ── */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Sync History</h2>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {runsQuery.isLoading ? (
                <tr>
                  <td colSpan={runsColumns.length} className="px-4 py-10 text-center text-muted-foreground">
                    Loading sync history…
                  </td>
                </tr>
              ) : runsQuery.isError ? (
                <tr>
                  <td colSpan={runsColumns.length} className="px-4 py-10 text-center text-destructive">
                    Failed to load sync history.
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={runsColumns.length} className="px-4 py-10 text-center text-muted-foreground">
                    No sync runs yet. Upload a GRN Excel file to get started.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b last:border-0 transition-colors hover:bg-muted/30',
                      row.original.id === activeConflictRunId && 'bg-muted/40',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {runsQuery.data && (
          <p className="text-xs text-muted-foreground">
            {runsQuery.data.pagination.total} sync run{runsQuery.data.pagination.total !== 1 ? 's' : ''} total
          </p>
        )}
      </div>
    </div>
  )
}
