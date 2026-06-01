import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import {
  FileText,
  Clock,
  CheckCircle2,
  Banknote,
  FilePlus,
  FileEdit,
  Trash2,
  Activity,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChartPoint {
  month: number
  year: number
  uploaded: number
  reconciled: number
  paid: number
}

interface VendorRow {
  vendorId: string
  vendorName: string
  invoiced: number
  reconciled: number
  paid: number
  pending: number
}

interface ActivityEntry {
  action: string
  entityType: string
  userName: string | null
  createdAt: string
}

interface DashboardStats {
  totalInvoices: number
  pendingReview: number
  reconciledThisMonth: number
  paidThisMonthAmount: number
  monthlyChart: ChartPoint[]
  vendorSummaryCurrentMonth: VendorRow[]
  recentActivity: ActivityEntry[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function inr(n: number): string {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
}

function activityDescription(entry: ActivityEntry): string {
  const who = entry.userName ?? 'Unknown'
  const entity = entry.entityType.replace(/_/g, ' ').toLowerCase()
  const act = entry.action.toUpperCase()
  if (act === 'CREATE') return `${who} created a ${entity}`
  if (act === 'UPDATE') return `${who} updated a ${entity}`
  if (act === 'DELETE') return `${who} deleted a ${entity}`
  return `${who} — ${entry.action} on ${entity}`
}

function ActivityIcon({ action }: { action: string }) {
  const act = action.toUpperCase()
  if (act === 'CREATE') return <FilePlus size={15} className="text-green-600 shrink-0" />
  if (act === 'UPDATE') return <FileEdit size={15} className="text-blue-600 shrink-0" />
  if (act === 'DELETE') return <Trash2 size={15} className="text-red-600 shrink-0" />
  return <Activity size={15} className="text-muted-foreground shrink-0" />
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-lg border bg-card px-5 py-5 space-y-1.5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className={cn('text-2xl font-bold tracking-tight truncate', valueClassName)}>{value}</p>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card px-5 py-5 space-y-3 animate-pulse">
      <div className="h-4 bg-muted rounded w-1/2" />
      <div className="h-7 bg-muted rounded w-3/4" />
    </div>
  )
}

// ── Vendor table columns ───────────────────────────────────────────────────────

const vendorColumns: ColumnDef<VendorRow>[] = [
  {
    accessorKey: 'vendorName',
    header: 'Vendor',
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ),
  },
  {
    accessorKey: 'invoiced',
    header: 'Invoiced',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{inr(getValue() as number)}</span>
    ),
  },
  {
    accessorKey: 'reconciled',
    header: 'Reconciled',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{inr(getValue() as number)}</span>
    ),
  },
  {
    accessorKey: 'paid',
    header: 'Paid',
    cell: ({ getValue }) => (
      <span className="tabular-nums">{inr(getValue() as number)}</span>
    ),
  },
  {
    accessorKey: 'pending',
    header: 'Pending',
    cell: ({ getValue }) => {
      const v = getValue() as number
      return v > 0 ? (
        <span className="tabular-nums font-medium text-amber-700">{inr(v)}</span>
      ) : (
        <span className="text-green-700 tabular-nums">—</span>
      )
    },
  },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const [sorting, setSorting] = useState<SortingState>([])

  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () =>
      api.get('/reports/dashboard-stats').then((r) => r.data as DashboardStats),
    refetchInterval: 60_000,
  })

  const chartData = (data?.monthlyChart ?? []).map((m) => ({
    label: `${MONTH_ABBR[m.month - 1] ?? ''} ${String(m.year).slice(2)}`,
    Uploaded: m.uploaded,
    Reconciled: m.reconciled,
    Paid: m.paid,
  }))

  const table = useReactTable({
    data: data?.vendorSummaryCurrentMonth ?? [],
    columns: vendorColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Failed to load dashboard data. Please refresh the page.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <SummaryCard
              icon={<FileText size={18} className="text-muted-foreground" />}
              label="Total Invoices"
              value={data!.totalInvoices.toLocaleString()}
            />
            <SummaryCard
              icon={
                <Clock
                  size={18}
                  className={data!.pendingReview > 0 ? 'text-amber-500' : 'text-muted-foreground'}
                />
              }
              label="Pending Review"
              value={data!.pendingReview.toLocaleString()}
              valueClassName={data!.pendingReview > 0 ? 'text-amber-700' : undefined}
            />
            <SummaryCard
              icon={<CheckCircle2 size={18} className="text-indigo-500" />}
              label="Reconciled This Month"
              value={data!.reconciledThisMonth.toLocaleString()}
            />
            <SummaryCard
              icon={<Banknote size={18} className="text-emerald-500" />}
              label="Paid This Month"
              value={inr(data!.paidThisMonthAmount)}
            />
          </>
        )}
      </div>

      {/* Bar chart */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-base">Invoice Activity — Last 12 Months</h2>
        {isLoading ? (
          <div className="h-[280px] animate-pulse bg-muted rounded" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={32} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Uploaded" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Reconciled" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Paid" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Vendor summary + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vendor table — 2/3 width */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-6 space-y-3">
          <h2 className="font-semibold text-base">Vendor Summary — Current Month</h2>
          {isLoading ? (
            <div className="h-40 animate-pulse bg-muted rounded" />
          ) : data!.vendorSummaryCurrentMonth.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No vendor activity this month.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {({ asc: ' ↑', desc: ' ↓' } as Record<string, string>)[
                            header.column.getIsSorted() as string
                          ] ?? ''}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() =>
                        navigate(`/admin/ledger?vendorId=${row.original.vendorId}`)
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2.5">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && data!.vendorSummaryCurrentMonth.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Click a row to view full vendor ledger.
            </p>
          )}
        </div>

        {/* Recent activity — 1/3 width */}
        <div className="rounded-lg border bg-card p-6 space-y-3">
          <h2 className="font-semibold text-base">Recent Activity</h2>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-2 animate-pulse">
                  <div className="h-4 w-4 rounded bg-muted shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-muted rounded w-5/6" />
                    <div className="h-3 bg-muted rounded w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (data?.recentActivity ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No recent activity.
            </p>
          ) : (
            <ul className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {data!.recentActivity.map((entry, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span className="mt-0.5">
                    <ActivityIcon action={entry.action} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-snug">{activityDescription(entry)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
