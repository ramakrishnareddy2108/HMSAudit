import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingActions {
  reviewQueueCount: number
  reviewQueueOldestDaysAgo: number
  sentBackCount: number
  sentBackOldestDaysAgo: number
  unreconciledAmount: number
  unreconciledInvoiceCount: number
  excelOnlyPendingCount: number
}

interface VendorPaymentRow {
  id: string
  name: string
  readyToPayAmount: number
  needsReconAmount: number
  underReviewAmount: number
  totalOutstanding: number
}

interface ReconMonth {
  month: number
  year: number
  label: string
  grnUploaded: boolean
  reconciliationDone: boolean
  unresolvedCount: number
  pendingPaymentAmount: number
  status: 'needs_grn' | 'needs_reconciliation' | 'has_disputes' | 'ready_to_pay' | 'complete'
}

interface DashboardStats {
  pendingActions: PendingActions
  vendorPaymentStatus: VendorPaymentRow[]
  reconciliationStatus: ReconMonth[]
  grnUploadPendingMonths: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ── Action Tile ────────────────────────────────────────────────────────────────

function ActionTile({
  title,
  mainValue,
  subText,
  colorClass,
  buttonLabel,
  onClick,
  disabled = false,
}: {
  title: string
  mainValue: string
  subText?: string
  colorClass: string
  buttonLabel: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <div className={cn('rounded-lg border px-5 py-4 flex flex-col gap-2', colorClass)}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{title}</p>
      <p className="text-2xl font-bold leading-tight">{mainValue}</p>
      {subText && <p className="text-sm opacity-75 leading-snug">{subText}</p>}
      <button
        onClick={onClick}
        disabled={disabled}
        className="mt-auto self-start text-xs font-semibold underline underline-offset-2 opacity-80 hover:opacity-100 disabled:opacity-40"
      >
        {buttonLabel}
      </button>
    </div>
  )
}

function SkeletonTile() {
  return (
    <div className="rounded-lg border bg-card px-5 py-4 space-y-3 animate-pulse">
      <div className="h-3 bg-muted rounded w-1/3" />
      <div className="h-7 bg-muted rounded w-1/2" />
      <div className="h-3 bg-muted rounded w-2/3" />
    </div>
  )
}

// ── Vendor table columns ───────────────────────────────────────────────────────

function buildVendorColumns(navigate: ReturnType<typeof useNavigate>): ColumnDef<VendorPaymentRow>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Vendor',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: 'readyToPayAmount',
      header: 'Ready to Pay',
      cell: ({ getValue }) => {
        const v = getValue() as number
        return v > 0
          ? <span className="tabular-nums font-medium text-green-700">{inr(v)}</span>
          : <span className="text-muted-foreground tabular-nums">—</span>
      },
    },
    {
      accessorKey: 'needsReconAmount',
      header: 'Needs Recon',
      cell: ({ getValue }) => {
        const v = getValue() as number
        return v > 0
          ? <span className="tabular-nums font-medium text-amber-700">{inr(v)}</span>
          : <span className="text-muted-foreground tabular-nums">—</span>
      },
    },
    {
      accessorKey: 'underReviewAmount',
      header: 'Under Review',
      cell: ({ getValue }) => {
        const v = getValue() as number
        return v > 0
          ? <span className="tabular-nums text-blue-700">{inr(v)}</span>
          : <span className="text-muted-foreground tabular-nums">—</span>
      },
    },
    {
      accessorKey: 'totalOutstanding',
      header: 'Total',
      cell: ({ getValue }) => (
        <span className="tabular-nums font-semibold">{inr(getValue() as number)}</span>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: ({ row }) => {
        const { id, readyToPayAmount, needsReconAmount, totalOutstanding } = row.original
        if (totalOutstanding === 0) {
          return <span className="text-green-700 text-xs font-medium">Cleared ✓</span>
        }
        if (readyToPayAmount > 0) {
          return (
            <button
              onClick={() => navigate(`/admin/payments?vendorId=${id}`)}
              className="text-xs font-semibold text-green-700 hover:underline whitespace-nowrap"
            >
              Pay {inr(readyToPayAmount)} →
            </button>
          )
        }
        if (needsReconAmount > 0) {
          return (
            <button
              onClick={() => navigate('/admin/reconciliation')}
              className="text-xs font-semibold text-amber-700 hover:underline"
            >
              Reconcile →
            </button>
          )
        }
        return null
      },
    },
  ]
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const { activeHospitalName } = useAuthStore()
  const [sorting, setSorting] = useState<SortingState>([])

  const now = new Date()
  const currentMonthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`

  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/reports/dashboard-stats').then((r) => r.data as DashboardStats),
    refetchInterval: 60_000,
  })

  const vendorColumns = buildVendorColumns(navigate)

  const table = useReactTable({
    data: data?.vendorPaymentStatus ?? [],
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

  const pa = data?.pendingActions
  const totalReadyToPay = (data?.vendorPaymentStatus ?? []).reduce((s, v) => s + v.readyToPayAmount, 0)
  const vendorsReadyCount = (data?.vendorPaymentStatus ?? []).filter((v) => v.readyToPayAmount > 0).length

  const allClear =
    !isLoading &&
    (pa?.reviewQueueCount ?? 1) === 0 &&
    (pa?.sentBackCount ?? 1) === 0 &&
    (pa?.unreconciledInvoiceCount ?? 1) === 0 &&
    (pa?.excelOnlyPendingCount ?? 1) === 0 &&
    (data?.grnUploadPendingMonths.length ?? 1) === 0

  // Totals row for vendor table
  const vendorTotals = (data?.vendorPaymentStatus ?? []).reduce(
    (acc, v) => {
      acc.ready += v.readyToPayAmount
      acc.recon += v.needsReconAmount
      acc.review += v.underReviewAmount
      acc.total += v.totalOutstanding
      return acc
    },
    { ready: 0, recon: 0, review: 0, total: 0 },
  )

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard{activeHospitalName ? ` — ${activeHospitalName}` : ''}
        </h1>
        <span className="text-sm text-muted-foreground">{currentMonthLabel}</span>
      </div>

      {/* Section 1 — Actions Needed */}
      <section className="space-y-3">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Actions Needed
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonTile key={i} />)}
          </div>
        ) : allClear ? (
          <div className="rounded-lg border border-green-300 bg-green-50 px-6 py-5 flex items-center gap-3">
            <CheckCircle2 size={22} className="text-green-600 shrink-0" />
            <span className="font-semibold text-green-800 text-lg">All caught up ✓</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Row 1 */}
            <ActionTile
              title="Pending Review"
              mainValue={pa!.reviewQueueCount.toLocaleString()}
              subText={
                pa!.reviewQueueCount > 0
                  ? `oldest ${pa!.reviewQueueOldestDaysAgo} day${pa!.reviewQueueOldestDaysAgo === 1 ? '' : 's'} ago`
                  : 'Queue is empty'
              }
              colorClass={
                pa!.reviewQueueCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-green-50 border-green-200 text-green-900'
              }
              buttonLabel="Review Now →"
              onClick={() => navigate('/review')}
            />

            <ActionTile
              title="Sent Back"
              mainValue={pa!.sentBackCount.toLocaleString()}
              subText={
                pa!.sentBackCount > 0
                  ? `waiting ${pa!.sentBackOldestDaysAgo} day${pa!.sentBackOldestDaysAgo === 1 ? '' : 's'}`
                  : 'Nothing sent back'
              }
              colorClass={
                pa!.sentBackCount > 0
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-green-50 border-green-200 text-green-900'
              }
              buttonLabel="View →"
              onClick={() => navigate('/invoices?status=sent_back')}
            />

            <ActionTile
              title="Ready to Pay"
              mainValue={inr(totalReadyToPay)}
              subText={
                vendorsReadyCount > 0
                  ? `${vendorsReadyCount} vendor${vendorsReadyCount === 1 ? '' : 's'} eligible`
                  : 'No payments ready'
              }
              colorClass={
                totalReadyToPay > 0
                  ? 'bg-green-50 border-green-200 text-green-900'
                  : 'bg-card border-border text-foreground'
              }
              buttonLabel="Pay Now →"
              onClick={() => navigate('/admin/payments')}
              disabled={totalReadyToPay === 0}
            />

            {/* Row 2 */}
            <ActionTile
              title="Unreconciled"
              mainValue={inr(pa!.unreconciledAmount)}
              subText={
                pa!.unreconciledInvoiceCount > 0
                  ? `${pa!.unreconciledInvoiceCount} invoice${pa!.unreconciledInvoiceCount === 1 ? '' : 's'} approved`
                  : 'All reconciled'
              }
              colorClass={
                pa!.unreconciledInvoiceCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-green-50 border-green-200 text-green-900'
              }
              buttonLabel="Reconcile →"
              onClick={() => navigate('/admin/reconciliation')}
            />

            <ActionTile
              title="GRN Upload Pending"
              mainValue={
                (data?.grnUploadPendingMonths.length ?? 0) > 0
                  ? `${data!.grnUploadPendingMonths.length} month${data!.grnUploadPendingMonths.length === 1 ? '' : 's'}`
                  : 'Up to date'
              }
              subText={data?.grnUploadPendingMonths.join(', ') || undefined}
              colorClass={
                (data?.grnUploadPendingMonths ?? []).includes(currentMonthLabel)
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : (data?.grnUploadPendingMonths.length ?? 0) > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-green-50 border-green-200 text-green-900'
              }
              buttonLabel="Upload GRN →"
              onClick={() => navigate('/admin/grn-sync')}
            />

            <ActionTile
              title="Missing Invoices"
              mainValue={pa!.excelOnlyPendingCount.toLocaleString()}
              subText={
                pa!.excelOnlyPendingCount > 0
                  ? 'departments need to upload'
                  : 'No missing invoices'
              }
              colorClass={
                pa!.excelOnlyPendingCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-green-50 border-green-200 text-green-900'
              }
              buttonLabel="View →"
              onClick={() => navigate('/admin/reconciliation?tab=excel_only')}
            />
          </div>
        )}
      </section>

      {/* Section 2 — Outstanding Payments */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base">Outstanding Payments</h2>
        <div className="rounded-lg border bg-card overflow-hidden">
          {isLoading ? (
            <div className="h-40 animate-pulse bg-muted m-4 rounded" />
          ) : (data?.vendorPaymentStatus.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-8 text-center">
              No outstanding amounts.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id}>
                        {hg.headers.map((header) => (
                          <th
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none whitespace-nowrap"
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
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-2.5">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="bg-muted/30 border-t-2 font-semibold">
                      <td className="px-4 py-2.5 text-sm">Total</td>
                      <td className="px-4 py-2.5 tabular-nums text-green-700">{inr(vendorTotals.ready)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-amber-700">{inr(vendorTotals.recon)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-blue-700">{inr(vendorTotals.review)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{inr(vendorTotals.total)}</td>
                      <td className="px-4 py-2.5" />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t">
                <button
                  onClick={() => navigate('/admin/ledger')}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  View All Vendors →
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Section 3 — Reconciliation Status */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base">Reconciliation — Last 3 Months</h2>
        <div className="rounded-lg border bg-card overflow-hidden">
          {isLoading ? (
            <div className="h-32 animate-pulse bg-muted m-4 rounded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    {['Month', 'GRN Upload', 'Reconciled', 'Disputes', 'Pending Payment', 'Action'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.reconciliationStatus ?? []).map((row) => (
                    <tr key={`${row.year}-${row.month}`} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{row.label}</td>

                      {/* GRN Upload */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.grnUploaded ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 size={14} /> Uploaded
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600">
                            <XCircle size={14} /> Missing
                          </span>
                        )}
                      </td>

                      {/* Reconciled */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {!row.grnUploaded ? (
                          <span className="text-muted-foreground">—</span>
                        ) : row.reconciliationDone ? (
                          row.unresolvedCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle size={14} /> {row.unresolvedCount} unresolved
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-700">
                              <CheckCircle2 size={14} /> Done
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground text-xs">Pending</span>
                        )}
                      </td>

                      {/* Disputes */}
                      <td className="px-4 py-3">
                        {row.unresolvedCount > 0 ? (
                          <span className="font-medium text-red-600">{row.unresolvedCount}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Pending Payment */}
                      <td className="px-4 py-3 tabular-nums">
                        {row.pendingPaymentAmount > 0 ? (
                          <span className="font-medium text-green-700">{inr(row.pendingPaymentAmount)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <ReconAction row={row} navigate={navigate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ReconAction({
  row,
  navigate,
}: {
  row: ReconMonth
  navigate: ReturnType<typeof useNavigate>
}) {
  switch (row.status) {
    case 'needs_grn':
      return (
        <button
          onClick={() => navigate('/admin/grn-sync')}
          className="text-xs font-semibold text-red-700 hover:underline"
        >
          Upload GRN →
        </button>
      )
    case 'needs_reconciliation':
      return (
        <button
          onClick={() => navigate(`/admin/reconciliation?month=${row.month}&year=${row.year}`)}
          className="text-xs font-semibold text-amber-700 hover:underline"
        >
          Run Reconciliation →
        </button>
      )
    case 'has_disputes':
      return (
        <button
          onClick={() => navigate(`/admin/reconciliation?month=${row.month}&year=${row.year}`)}
          className="text-xs font-semibold text-red-700 hover:underline"
        >
          Resolve {row.unresolvedCount} →
        </button>
      )
    case 'ready_to_pay':
      return (
        <button
          onClick={() => navigate('/admin/payments')}
          className="text-xs font-semibold text-green-700 hover:underline"
        >
          Pay {inr(row.pendingPaymentAmount)} →
        </button>
      )
    case 'complete':
      return <span className="text-xs font-medium text-green-700">Complete ✓</span>
  }
}
