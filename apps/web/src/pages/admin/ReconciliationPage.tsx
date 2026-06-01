import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

type MatchStatus = 'matched' | 'amount_diff' | 'app_only' | 'excel_only'
type TabStatus = 'all' | MatchStatus

interface ReconciliationRun {
  id: string
  periodMonth: number
  periodYear: number
  runBy: string
  status: 'running' | 'completed'
  totalMatched: number
  totalAmountDiff: number
  totalAppOnly: number
  totalExcelOnly: number
  createdAt: string
  completedAt: string | null
  completedBy: string | null
  runner: { id: string; name: string }
}

interface RunsResponse {
  data: ReconciliationRun[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface ReconResult {
  id: string
  reconRunId: string
  grnEntryId: string | null
  grnMasterId: string | null
  matchStatus: MatchStatus
  appAmount: string | null
  excelAmount: string | null
  resolution: 'accepted_app' | 'accepted_excel' | 'disputed' | null
  adminNote: string | null
  resolvedAt: string | null
  createdAt: string
  grnEntry: {
    id: string
    grnNumber: string
    grnAmount: string
    status: string
    invoice: {
      id: string
      invoiceNumber: string
      invoiceAmount: string
      fileUrl: string | null
      vendor: { id: string; name: string }
    }
  } | null
  grnMaster: {
    id: string
    grnNumber: string
    grnAmount: string
    vendor: { id: string; name: string }
  } | null
  resolver: { id: string; name: string } | null
}

interface ResultsResponse {
  data: ReconResult[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  counts: { matched: number; amount_diff: number; app_only: number; excel_only: number }
}

interface SyncRunCheck {
  data: Array<{ id: string; status: string }>
}

interface RunResult {
  runId: string
  totalMatched: number
  totalAmountDiff: number
  totalAppOnly: number
  totalExcelOnly: number
}

type ApiError = { response?: { data?: { error?: string; unresolvedConflicts?: number; unresolvedCount?: number } } }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function fmt(n: string | number | null): string {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getGrnNumber(r: ReconResult): string {
  return r.grnEntry?.grnNumber ?? r.grnMaster?.grnNumber ?? '—'
}

function getVendorName(r: ReconResult): string {
  return r.grnEntry?.invoice.vendor.name ?? r.grnMaster?.vendor.name ?? '—'
}

function getInvoiceNumber(r: ReconResult): string {
  return r.grnEntry?.invoice.invoiceNumber ?? '—'
}

function matchStatusBadge(status: MatchStatus) {
  switch (status) {
    case 'matched':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Matched</Badge>
    case 'amount_diff':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Amount Diff</Badge>
    case 'app_only':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">App Only</Badge>
    case 'excel_only':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Excel Only</Badge>
  }
}

function resolutionBadge(resolution: ReconResult['resolution']) {
  switch (resolution) {
    case 'accepted_app':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Accepted App</Badge>
    case 'accepted_excel':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Accepted Excel</Badge>
    case 'disputed':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Disputed</Badge>
    default:
      return null
  }
}

function exportToCsv(results: ReconResult[], run: ReconciliationRun) {
  const header = ['GRN Number', 'Vendor', 'Invoice No.', 'App Amount', 'Excel Amount', 'Status', 'Resolution']
  const rows = results.map((r) => [
    getGrnNumber(r),
    getVendorName(r),
    getInvoiceNumber(r),
    r.appAmount ? `₹${Number(r.appAmount).toLocaleString('en-IN')}` : '',
    r.excelAmount ? `₹${Number(r.excelAmount).toLocaleString('en-IN')}` : '',
    r.matchStatus,
    r.resolution ?? '',
  ])
  const csv = [header, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reconciliation_${MONTHS[run.periodMonth - 1]}_${run.periodYear}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Resolve Dialog ─────────────────────────────────────────────────────────────

interface ResolveDialogProps {
  result: ReconResult | null
  note: string
  onNoteChange: (n: string) => void
  onResolve: (resolution: 'accepted_app' | 'accepted_excel' | 'disputed') => void
  isPending: boolean
  onClose: () => void
}

function ResolveDialog({ result, note, onNoteChange, onResolve, isPending, onClose }: ResolveDialogProps) {
  const [expandImage, setExpandImage] = useState(false)

  useEffect(() => {
    if (!result) setExpandImage(false)
  }, [result])

  const canSubmit = note.trim().length > 0 && !isPending
  const fileUrl = result?.grnEntry?.invoice.fileUrl ?? null

  return (
    <Dialog open={Boolean(result)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve GRN {result ? getGrnNumber(result) : ''}</DialogTitle>
        </DialogHeader>

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                <p className="font-medium">{getVendorName(result)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invoice No.</p>
                <p className="font-mono font-medium">{getInvoiceNumber(result)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Match Status</p>
                <div className="mt-0.5">{matchStatusBadge(result.matchStatus)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">App Amount</p>
                <p className="text-lg font-semibold tabular-nums">{fmt(result.appAmount)}</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Excel Amount</p>
                <p className="text-lg font-semibold tabular-nums">{fmt(result.excelAmount)}</p>
              </div>
            </div>

            {fileUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Invoice Document</p>
                {expandImage ? (
                  <div className="space-y-2">
                    <img
                      src={fileUrl}
                      alt="Invoice"
                      className="w-full rounded border object-contain max-h-96"
                    />
                    <Button variant="ghost" size="sm" onClick={() => setExpandImage(false)}>
                      Collapse
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded border p-2 text-sm hover:bg-muted/50 transition-colors w-full text-left"
                    onClick={() => setExpandImage(true)}
                  >
                    <img
                      src={fileUrl}
                      alt="Invoice thumbnail"
                      className="h-14 w-14 object-cover rounded shrink-0"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                    <span className="text-muted-foreground text-xs">Click to expand invoice image</span>
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>
                Admin Note <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Explain the reason for your decision…"
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50"
            disabled={!canSubmit}
            onClick={() => onResolve('disputed')}
          >
            Mark Disputed
          </Button>
          <Button
            variant="outline"
            disabled={!canSubmit}
            onClick={() => onResolve('accepted_excel')}
          >
            Accept Excel Value
          </Button>
          <Button disabled={!canSubmit} onClick={() => onResolve('accepted_app')}>
            Accept App Value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const now = new Date()
  const queryClient = useQueryClient()

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabStatus>('all')
  const [resultPage, setResultPage] = useState(1)
  const [resolveTarget, setResolveTarget] = useState<ReconResult | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false)
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null)

  const runsQuery = useQuery<RunsResponse>({
    queryKey: ['reconciliation-runs'],
    queryFn: () =>
      api.get('/reconciliation/runs', { params: { limit: 50 } }).then((r) => r.data),
  })

  const grnSyncCheckQuery = useQuery<SyncRunCheck>({
    queryKey: ['grn-sync-runs-check'],
    queryFn: () =>
      api.get('/grn-sync/runs', { params: { limit: 100 } }).then((r) => r.data),
  })

  const resultsQuery = useQuery<ResultsResponse>({
    queryKey: ['reconciliation-results', activeRunId, activeTab, resultPage],
    queryFn: () =>
      api
        .get(`/reconciliation/runs/${activeRunId}/results`, {
          params: {
            matchStatus: activeTab === 'all' ? undefined : activeTab,
            page: resultPage,
            limit: 50,
          },
        })
        .then((r) => r.data),
    enabled: Boolean(activeRunId),
  })

  const hasUnresolvedGrnConflicts =
    grnSyncCheckQuery.data?.data.some((r) => r.status === 'has_conflicts') ?? false

  useEffect(() => {
    if (!activeRunId && runsQuery.data?.data[0]) {
      setActiveRunId(runsQuery.data.data[0].id)
    }
  }, [runsQuery.data, activeRunId])

  useEffect(() => {
    setActiveTab('all')
    setResultPage(1)
  }, [activeRunId])

  const runMutation = useMutation({
    mutationFn: ({ month, year }: { month: number; year: number }) =>
      api.post<RunResult>('/reconciliation/run', { month, year }).then((r) => r.data),
    onSuccess: (result) => {
      setLastRunResult(result)
      setActiveRunId(result.runId)
      queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] })
      toast.success('Reconciliation complete')
    },
    onError: (err: unknown) => {
      const e = err as ApiError
      toast.error(e.response?.data?.error ?? 'Reconciliation failed')
    },
  })

  const resolveMutation = useMutation({
    mutationFn: ({
      runId,
      resultId,
      resolution,
      adminNote,
    }: {
      runId: string
      resultId: string
      resolution: 'accepted_app' | 'accepted_excel' | 'disputed'
      adminNote: string
    }) =>
      api
        .post(`/reconciliation/runs/${runId}/results/${resultId}/resolve`, { resolution, adminNote })
        .then((r) => r.data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation-results', vars.runId] })
      setResolveTarget(null)
      setResolveNote('')
      toast.success('Result resolved')
    },
    onError: (err: unknown) => {
      toast.error((err as ApiError).response?.data?.error ?? 'Failed to resolve result')
    },
  })

  const completeMutation = useMutation({
    mutationFn: (runId: string) =>
      api.post(`/reconciliation/runs/${runId}/complete`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] })
      queryClient.invalidateQueries({ queryKey: ['reconciliation-results', activeRunId] })
      setCompleteConfirmOpen(false)
      toast.success('Reconciliation marked complete — GRNs locked')
    },
    onError: (err: unknown) => {
      const e = err as ApiError
      toast.error(e.response?.data?.error ?? 'Failed to complete reconciliation')
      setCompleteConfirmOpen(false)
    },
  })

  const activeRun = runsQuery.data?.data.find((r) => r.id === activeRunId)
  const counts = resultsQuery.data?.counts
  const results = resultsQuery.data?.data ?? []

  const allCount = counts ? counts.matched + counts.amount_diff + counts.app_only + counts.excel_only : undefined

  const TABS: { key: TabStatus; label: string; count: number | undefined }[] = [
    { key: 'all', label: 'All', count: allCount },
    { key: 'matched', label: 'Matched', count: counts?.matched },
    { key: 'amount_diff', label: 'Amount Diff', count: counts?.amount_diff },
    { key: 'app_only', label: 'App Only', count: counts?.app_only },
    { key: 'excel_only', label: 'Excel Only', count: counts?.excel_only },
  ]

  const yearRange = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i)

  const runsColumns: ColumnDef<ReconciliationRun>[] = [
    {
      id: 'period',
      header: 'Month',
      cell: ({ row }) =>
        `${MONTHS[row.original.periodMonth - 1]} ${row.original.periodYear}`,
    },
    {
      id: 'runBy',
      header: 'Run by',
      cell: ({ row }) => row.original.runner?.name ?? '—',
    },
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ getValue }) =>
        format(new Date(getValue() as string), 'dd MMM yyyy, HH:mm'),
    },
    {
      accessorKey: 'totalMatched',
      header: 'Matched',
      cell: ({ getValue }) => (
        <span className="tabular-nums text-green-700 font-medium">{getValue() as number}</span>
      ),
    },
    {
      accessorKey: 'totalAmountDiff',
      header: 'Diff',
      cell: ({ getValue }) => (
        <span className="tabular-nums text-amber-700">{getValue() as number}</span>
      ),
    },
    {
      id: 'disputes',
      header: 'Disputes',
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {row.original.totalAppOnly + row.original.totalExcelOnly}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as ReconciliationRun['status']
        return s === 'completed' ? (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>
        ) : (
          <Badge variant="secondary">Running</Badge>
        )
      },
    },
    {
      id: 'view',
      header: '',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant={row.original.id === activeRunId ? 'secondary' : 'ghost'}
          onClick={() => setActiveRunId(row.original.id)}
        >
          {row.original.id === activeRunId ? 'Viewing' : 'View'}
        </Button>
      ),
    },
  ]

  const resultsColumns: ColumnDef<ReconResult>[] = [
    {
      id: 'grnNumber',
      header: 'GRN Number',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{getGrnNumber(row.original)}</span>
      ),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      cell: ({ row }) => getVendorName(row.original),
    },
    {
      id: 'invoiceNo',
      header: 'Invoice No.',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{getInvoiceNumber(row.original)}</span>
      ),
    },
    {
      id: 'appAmount',
      header: 'App Amount',
      cell: ({ row }) => (
        <span className="tabular-nums">{fmt(row.original.appAmount)}</span>
      ),
    },
    {
      id: 'excelAmount',
      header: 'Excel Amount',
      cell: ({ row }) => (
        <span className="tabular-nums">{fmt(row.original.excelAmount)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const r = row.original
        if (r.resolution) return resolutionBadge(r.resolution)
        return matchStatusBadge(r.matchStatus)
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original
        if (r.matchStatus === 'matched' || r.resolution !== null) return null
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResolveTarget(r)
              setResolveNote('')
            }}
          >
            Resolve
          </Button>
        )
      },
    },
  ]

  const runsTable = useReactTable({
    data: runsQuery.data?.data ?? [],
    columns: runsColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const resultsTable = useReactTable({
    data: results,
    columns: resultsColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Reconciliation</h1>

      {/* ── Section 1: Run Panel ── */}
      <div className="rounded-lg border bg-card p-6 space-y-5">
        <h2 className="text-base font-semibold">Run Reconciliation</h2>

        {hasUnresolvedGrnConflicts && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Unresolved GRN conflicts detected. Resolve them in{' '}
              <a href="/admin/grn-sync" className="underline font-medium">
                GRN Sync
              </a>{' '}
              before running reconciliation.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="recon-month">Month</Label>
            <select
              id="recon-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recon-year">Year</Label>
            <select
              id="recon-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {yearRange.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <Button
            disabled={runMutation.isPending || hasUnresolvedGrnConflicts}
            onClick={() =>
              runMutation.mutate({ month: selectedMonth, year: selectedYear })
            }
          >
            {runMutation.isPending ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Running…
              </>
            ) : (
              <>
                <Play size={16} className="mr-2" />
                Run Reconciliation
              </>
            )}
          </Button>
        </div>

        {lastRunResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-md border bg-green-50 border-green-200 px-4 py-3 text-center">
              <CheckCircle2 size={20} className="text-green-600 mx-auto mb-1" />
              <p className="text-2xl font-bold tabular-nums text-green-800">
                {lastRunResult.totalMatched}
              </p>
              <p className="text-xs text-green-700 mt-0.5">Matched</p>
            </div>
            <div className="rounded-md border bg-amber-50 border-amber-200 px-4 py-3 text-center">
              <AlertTriangle size={20} className="text-amber-600 mx-auto mb-1" />
              <p className="text-2xl font-bold tabular-nums text-amber-800">
                {lastRunResult.totalAmountDiff}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">Amount Diff</p>
            </div>
            <div className="rounded-md border bg-red-50 border-red-200 px-4 py-3 text-center">
              <XCircle size={20} className="text-red-600 mx-auto mb-1" />
              <p className="text-2xl font-bold tabular-nums text-red-800">
                {lastRunResult.totalAppOnly}
              </p>
              <p className="text-xs text-red-700 mt-0.5">App Only</p>
            </div>
            <div className="rounded-md border bg-blue-50 border-blue-200 px-4 py-3 text-center">
              <XCircle size={20} className="text-blue-600 mx-auto mb-1" />
              <p className="text-2xl font-bold tabular-nums text-blue-800">
                {lastRunResult.totalExcelOnly}
              </p>
              <p className="text-xs text-blue-700 mt-0.5">Excel Only</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Results ── */}
      {activeRunId && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold">
              Results
              {activeRun && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {MONTHS[activeRun.periodMonth - 1]} {activeRun.periodYear}
                </span>
              )}
            </h2>
            {results.length > 0 && activeRun && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportToCsv(results, activeRun)}
              >
                <Download size={14} className="mr-2" />
                Export CSV
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1 border-b pb-3">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key)
                  setResultPage(1)
                }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground',
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      'ml-1.5 text-xs rounded-full px-1.5 py-0.5',
                      activeTab === tab.key
                        ? 'bg-white/20 text-inherit'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                {resultsTable.getHeaderGroups().map((hg) => (
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
                {resultsQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={resultsColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      Loading results…
                    </td>
                  </tr>
                ) : resultsTable.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={resultsColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No results in this category.
                    </td>
                  </tr>
                ) : (
                  resultsTable.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-b last:border-0 transition-colors hover:bg-muted/30',
                        row.original.matchStatus === 'matched' && 'bg-green-50/50',
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

          {resultsQuery.data && resultsQuery.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {resultPage} of {resultsQuery.data.pagination.totalPages} ·{' '}
                {resultsQuery.data.pagination.total} total
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resultPage === 1}
                  onClick={() => setResultPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resultPage === resultsQuery.data.pagination.totalPages}
                  onClick={() => setResultPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Complete button ── */}
      {activeRunId && activeRun && activeRun.status !== 'completed' && (
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium">Mark Reconciliation Complete</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                All non-matched GRNs must be resolved first. Locked GRNs cannot be edited.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setCompleteConfirmOpen(true)}
              disabled={completeMutation.isPending}
            >
              <Lock size={16} className="mr-2" />
              Mark Complete
            </Button>
          </div>
        </div>
      )}

      {/* ── Section 4: History ── */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Reconciliation History</h2>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              {runsTable.getHeaderGroups().map((hg) => (
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
                  <td
                    colSpan={runsColumns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Loading history…
                  </td>
                </tr>
              ) : runsTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={runsColumns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No reconciliation runs yet.
                  </td>
                </tr>
              ) : (
                runsTable.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b last:border-0 transition-colors hover:bg-muted/30',
                      row.original.id === activeRunId && 'bg-muted/40',
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
            {runsQuery.data.pagination.total} run{runsQuery.data.pagination.total !== 1 ? 's' : ''} total
          </p>
        )}
      </div>

      {/* ── Resolve Dialog ── */}
      <ResolveDialog
        result={resolveTarget}
        note={resolveNote}
        onNoteChange={setResolveNote}
        onResolve={(resolution) => {
          if (!resolveTarget || !activeRunId) return
          resolveMutation.mutate({
            runId: activeRunId,
            resultId: resolveTarget.id,
            resolution,
            adminNote: resolveNote,
          })
        }}
        isPending={resolveMutation.isPending}
        onClose={() => {
          setResolveTarget(null)
          setResolveNote('')
        }}
      />

      {/* ── Complete Confirm Dialog ── */}
      <Dialog open={completeConfirmOpen} onOpenChange={(o) => !o && setCompleteConfirmOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock size={18} className="text-destructive" />
              Mark Reconciliation Complete?
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="space-y-2 text-sm">
            <p>
              All reconciled GRNs for{' '}
              {activeRun
                ? `${MONTHS[activeRun.periodMonth - 1]} ${activeRun.periodYear}`
                : 'this period'}{' '}
              will be locked and cannot be edited.
            </p>
            <p className="text-destructive font-medium text-xs">This action cannot be undone.</p>
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCompleteConfirmOpen(false)}
              disabled={completeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={completeMutation.isPending}
              onClick={() => activeRunId && completeMutation.mutate(activeRunId)}
            >
              {completeMutation.isPending ? 'Completing…' : 'Confirm & Lock GRNs'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
