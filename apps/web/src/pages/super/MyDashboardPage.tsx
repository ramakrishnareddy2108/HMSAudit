import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

interface WorkStatus {
  grnUploaded: boolean
  grnUploadedDate: string | null
  reconciliationDone: boolean
  unresolvedConflicts: number
  readyToPayAmount: number
  readyToPayGrnCount: number
  readyToPayVendorCount: number
  pendingReviewCount: number
  sentBackCount: number
  status: 'needs_grn' | 'needs_resolution' | 'needs_reconciliation' | 'has_pending_review' | 'ready_to_pay' | 'complete'
}

interface HospitalRow {
  hospitalId: string
  hospitalName: string
  workStatus: WorkStatus
  overall: {
    totalOutstanding: number
    needsReconAmount: number
    totalVendors: number
    totalUsers: number
  }
}

interface MonthlyStatusResponse {
  hospitals: HospitalRow[]
  crossHospitalTotals: {
    totalPendingReview: number
    totalReadyToPay: number
    totalReadyToPayGrnCount: number
    totalReadyToPayVendorCount: number
    totalNeedsRecon: number
    totalOutstanding: number
    hospitalsNeedingAction: number
  }
}

interface DbStats {
  top5Tables: { tablename: string; size: string; sizeBytes: number }[]
  totalBytes: number
  rowCounts: { invoices: number; grnEntries: number; notifications: number; payments: number }
  storage: { totalSizeBytes: number; fileCount: number }
}

const INR = (v: number) =>
  v.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const ROW_BG: Record<WorkStatus['status'], string> = {
  complete: 'bg-green-50/60',
  ready_to_pay: 'bg-blue-50/60',
  has_pending_review: 'bg-sky-50/60',
  needs_reconciliation: 'bg-amber-50/60',
  needs_resolution: 'bg-amber-50/60',
  needs_grn: 'bg-red-50/60',
}

function buildColumns(
  setActiveHospital: (id: string, name: string) => void,
  navigate: ReturnType<typeof useNavigate>,
): ColumnDef<HospitalRow>[] {
  return [
    {
      id: 'hospital',
      header: 'Hospital Name',
      cell: ({ row }) => {
        const h = row.original
        return (
          <button
            className="font-medium hover:underline text-left text-sm"
            onClick={() => {
              setActiveHospital(h.hospitalId, h.hospitalName)
              navigate('/admin/dashboard')
            }}
          >
            {h.hospitalName}
          </button>
        )
      },
    },
    {
      id: 'grn',
      header: 'GRN Upload',
      cell: ({ row }) => {
        const ws = row.original.workStatus
        if (ws.grnUploaded && ws.grnUploadedDate) {
          return (
            <span className="flex items-center gap-1.5 text-xs text-green-700">
              <CheckCircle2 size={14} className="shrink-0" />
              {new Date(ws.grnUploadedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </span>
          )
        }
        return <XCircle size={14} className="text-red-500" />
      },
    },
    {
      id: 'recon',
      header: 'Recon Status',
      cell: ({ row }) => {
        const ws = row.original.workStatus
        if (!ws.grnUploaded) return <span className="text-muted-foreground text-xs">—</span>
        if (ws.unresolvedConflicts > 0)
          return (
            <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
              ⚠ {ws.unresolvedConflicts} dispute{ws.unresolvedConflicts !== 1 ? 's' : ''}
            </span>
          )
        if (!ws.reconciliationDone)
          return <XCircle size={14} className="text-red-500" />
        return (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 size={14} /> Complete
          </span>
        )
      },
    },
    {
      id: 'disputes',
      header: 'Disputes',
      cell: ({ row }) => {
        const c = row.original.workStatus.unresolvedConflicts
        return c > 0 ? (
          <span className="text-red-600 font-semibold text-sm tabular-nums">{c}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )
      },
    },
    {
      id: 'review',
      header: 'Pending Review',
      cell: ({ row }) => {
        const c = row.original.workStatus.pendingReviewCount
        return c > 0 ? (
          <span className="text-amber-700 font-semibold text-sm tabular-nums">{c}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )
      },
    },
    {
      id: 'pay',
      header: 'Ready to Pay',
      cell: ({ row }) => {
        const a = row.original.workStatus.readyToPayAmount
        return a > 0 ? (
          <span className="text-green-700 font-semibold text-sm tabular-nums">{INR(a)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )
      },
    },
    {
      id: 'action',
      header: 'Action',
      cell: ({ row }) => {
        const h = row.original
        const ws = h.workStatus

        const go = (path: string) => {
          setActiveHospital(h.hospitalId, h.hospitalName)
          navigate(path)
        }

        if (ws.status === 'complete') {
          return <span className="text-green-600 text-xs font-medium">Complete ✓</span>
        }
        if (ws.status === 'needs_grn') {
          return (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go('/admin/grn-sync')}>
              Upload GRN
            </Button>
          )
        }
        if (ws.status === 'needs_resolution') {
          return (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go('/admin/grn-sync')}>
              Resolve {ws.unresolvedConflicts} conflict{ws.unresolvedConflicts !== 1 ? 's' : ''}
            </Button>
          )
        }
        if (ws.status === 'needs_reconciliation') {
          return (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go('/admin/reconciliation')}>
              Reconcile
            </Button>
          )
        }
        if (ws.status === 'has_pending_review') {
          return (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go('/review')}>
              Review {ws.pendingReviewCount} invoice{ws.pendingReviewCount !== 1 ? 's' : ''}
            </Button>
          )
        }
        if (ws.status === 'ready_to_pay') {
          return (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go('/admin/payments')}>
              Pay {INR(ws.readyToPayAmount)}
            </Button>
          )
        }
        return null
      },
    },
  ]
}

function DbUsageCard({ stats, onRefresh }: { stats: DbStats; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const MB = 1024 * 1024
  const LIMIT_MB = 500
  const usedMB = stats.totalBytes / MB
  const pct = Math.min(100, (usedMB / LIMIT_MB) * 100)
  const barColor = usedMB > 450 ? 'bg-red-500' : usedMB > 300 ? 'bg-amber-500' : 'bg-green-500'
  const textColor = usedMB > 450 ? 'text-red-600' : usedMB > 300 ? 'text-amber-600' : 'text-green-700'

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Database Usage</h3>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onRefresh}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Used</span>
          <span className={cn('font-semibold tabular-nums', textColor)}>
            {usedMB.toFixed(1)} MB of {LIMIT_MB} MB free tier
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Top 5 tables
      </button>
      {expanded && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 text-muted-foreground font-medium">Table</th>
              <th className="text-right py-1 text-muted-foreground font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {stats.top5Tables.map((t) => (
              <tr key={t.tablename} className="border-b last:border-0">
                <td className="py-1 font-mono">{t.tablename}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{t.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">
        Last checked: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  )
}

function R2StorageCard({ stats, onRefresh }: { stats: DbStats; onRefresh: () => void }) {
  const GB = 1024 * 1024 * 1024
  const LIMIT_GB = 10
  const usedGB = stats.storage.totalSizeBytes / GB
  const pct = Math.min(100, (usedGB / LIMIT_GB) * 100)
  const barColor = usedGB > 9 ? 'bg-red-500' : usedGB > 6 ? 'bg-amber-500' : 'bg-green-500'
  const textColor = usedGB > 9 ? 'text-red-600' : usedGB > 6 ? 'text-amber-600' : 'text-green-700'

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">R2 File Storage</h3>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onRefresh}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Used</span>
          <span className={cn('font-semibold tabular-nums', textColor)}>
            {usedGB.toFixed(2)} GB of {LIMIT_GB} GB
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {stats.storage.fileCount.toLocaleString('en-IN')} files stored
      </p>
      <p className="text-xs text-muted-foreground">
        Last checked: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  )
}

export default function MyDashboardPage() {
  const navigate = useNavigate()
  const { setActiveHospital } = useAuthStore()

  const now = new Date()
  const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const { data, isLoading, isError } = useQuery<MonthlyStatusResponse>({
    queryKey: ['super-monthly-status'],
    queryFn: () => api.get('/super/monthly-status').then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: dbStats, refetch: refetchDb } = useQuery<DbStats>({
    queryKey: ['super-db-stats'],
    queryFn: () => api.get('/super/db-stats').then((r) => r.data),
    staleTime: 1000 * 60 * 60,
  })

  const columns = buildColumns(setActiveHospital, navigate)

  const table = useReactTable({
    data: data?.hospitals ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const totals = data?.crossHospitalTotals

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Super Admin — All Hospitals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{monthLabel}</p>
      </div>

      {/* Section 1 — Cross-hospital summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={cn('rounded-lg border bg-card p-4 space-y-1', totals && totals.hospitalsNeedingAction > 0 && 'border-red-300 bg-red-50/60')}>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Hospitals Needing Action</p>
          <p className={cn('text-2xl font-bold tabular-nums', totals && totals.hospitalsNeedingAction > 0 ? 'text-red-600' : 'text-foreground')}>
            {isLoading ? '—' : (totals?.hospitalsNeedingAction ?? 0)}
          </p>
        </div>
        <div className={cn('rounded-lg border bg-card p-4 space-y-1.5', totals && totals.totalPendingReview > 0 ? 'border-amber-300 bg-amber-50/60' : '')}>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Review</p>
          <p className={cn('text-2xl font-bold tabular-nums', totals && totals.totalPendingReview > 0 ? 'text-amber-700' : 'text-foreground')}>
            {isLoading ? '—' : (totals?.totalPendingReview ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">Awaiting reviewer approval</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50/40 p-4 space-y-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Ready to Pay</p>
          <p className="text-2xl font-bold tabular-nums text-green-700">
            {isLoading ? '—' : INR(totals?.totalReadyToPay ?? 0)}
          </p>
          {!isLoading && totals && (
            <p className="text-xs text-muted-foreground">
              {totals.totalReadyToPayGrnCount} GRN{totals.totalReadyToPayGrnCount !== 1 ? 's' : ''} across {totals.totalReadyToPayVendorCount} vendor{totals.totalReadyToPayVendorCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Outstanding</p>
          <p className="text-2xl font-bold tabular-nums">
            {isLoading ? '—' : INR(totals?.totalOutstanding ?? 0)}
          </p>
          {!isLoading && totals && totals.totalNeedsRecon > 0 && (
            <p className="text-xs text-muted-foreground">
              Includes {INR(totals.totalNeedsRecon)} needs reconciliation
            </p>
          )}
        </div>
      </div>

      {/* Section 2 — Hospital status board */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm">Monthly Work Status — {monthLabel}</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-muted animate-pulse" style={{ width: j === 0 ? 140 : 80 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-destructive">
                    Failed to load hospital status. Please refresh.
                  </td>
                </tr>
              ) : !data?.hospitals.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No active hospitals found.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn('border-b last:border-0', ROW_BG[row.original.workStatus.status])}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3 — System health */}
      {dbStats && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">System Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DbUsageCard stats={dbStats} onRefresh={() => refetchDb()} />
            <R2StorageCard stats={dbStats} onRefresh={() => refetchDb()} />
          </div>
        </div>
      )}
    </div>
  )
}
