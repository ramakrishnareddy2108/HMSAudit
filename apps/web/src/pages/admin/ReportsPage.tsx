import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { exportToExcel } from '@/lib/exportToExcel'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type ActiveTab = 'reconciliation' | 'pending' | 'audit'

interface Department {
  id: string
  name: string
}

interface User {
  id: string
  name: string
}

interface ReconVendorRow {
  vendorId: string
  vendorName: string
  matched: number
  amountDiff: number
  appOnly: number
  excelOnly: number
}

interface ReconDeptRow {
  departmentId: string
  departmentName: string
  matched: number
  amountDiff: number
  appOnly: number
  excelOnly: number
}

interface ReconSummary {
  matched: number
  amountDiff: number
  appOnly: number
  excelOnly: number
  disputed: number
  byVendor: ReconVendorRow[]
  byDepartment: ReconDeptRow[]
}

interface PendingInvoice {
  id: string
  invoiceNumber: string
  invoiceAmount: number
  status: string
  billType: string
  createdAt: string
  daysPending: number
  vendor: { id: string; name: string }
  department: { id: string; name: string } | null
}

interface AuditLogEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  ipAddress: string | null
  createdAt: string
  user: { id: string; name: string } | null
}

interface AuditLogResponse {
  data: AuditLogEntry[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
}))

const selectCls =
  'flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'pending_review'
      ? 'bg-yellow-100 text-yellow-800'
      : status === 'sent_back'
        ? 'bg-red-100 text-red-800'
        : status === 're_submitted'
          ? 'bg-blue-100 text-blue-800'
          : status === 'approved'
            ? 'bg-green-100 text-green-800'
            : status === 'reconciled'
              ? 'bg-indigo-100 text-indigo-800'
              : status === 'paid'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-muted text-muted-foreground'
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        cls,
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string
  value: number
  colorClass: string
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4 text-center">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', colorClass)}>{value}</p>
    </div>
  )
}

function ReconBreakdownTable({
  title,
  nameHeader,
  rows,
}: {
  title: string
  nameHeader: string
  rows: { name: string; matched: number; amountDiff: number; appOnly: number; excelOnly: number }[]
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              {[nameHeader, 'Matched', 'Amount Diff', 'App Only', 'Excel Only'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No data.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 text-green-700 tabular-nums">{r.matched}</td>
                  <td className="px-3 py-2.5 text-amber-700 tabular-nums">{r.amountDiff}</td>
                  <td className="px-3 py-2.5 text-blue-700 tabular-nums">{r.appOnly}</td>
                  <td className="px-3 py-2.5 text-indigo-700 tabular-nums">{r.excelOnly}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab 1: Reconciliation Summary ─────────────────────────────────────────────

function ReconciliationTab() {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [loaded, setLoaded] = useState<{ month: number; year: number } | null>(null)

  const { data, isLoading, isError } = useQuery<ReconSummary>({
    queryKey: ['recon-summary', loaded],
    queryFn: () =>
      api
        .get('/reports/reconciliation-summary', {
          params: { month: loaded!.month, year: loaded!.year },
        })
        .then((r) => r.data as ReconSummary),
    enabled: Boolean(loaded),
  })

  function handleExport() {
    if (!data) return
    exportToExcel(
      `recon-summary-${loaded!.year}-${String(loaded!.month).padStart(2, '0')}`,
      ['Category', 'Vendor', 'Matched', 'Amount Diff', 'App Only', 'Excel Only'],
      [
        ...data.byVendor.map((v) => [
          'Vendor',
          v.vendorName,
          v.matched,
          v.amountDiff,
          v.appOnly,
          v.excelOnly,
        ]),
        ...data.byDepartment.map((d) => [
          'Department',
          d.departmentName,
          d.matched,
          d.amountDiff,
          d.appOnly,
          d.excelOnly,
        ]),
      ],
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Month</Label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={cn(selectCls, 'w-36')}
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Year</Label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={cn(selectCls, 'w-24')}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => setLoaded({ month, year })} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Generate'}
        </Button>
        {data && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2 ml-auto self-end"
          >
            <FileSpreadsheet size={15} />
            Export Excel
          </Button>
        )}
      </div>

      {!loaded && (
        <div className="rounded-md border px-6 py-14 text-center text-sm text-muted-foreground">
          Select a month and year, then click Generate.
        </div>
      )}

      {loaded && isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load reconciliation summary.
        </div>
      )}

      {loaded && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Matched" value={data.matched} colorClass="text-green-700" />
            <StatCard label="Amount Diff" value={data.amountDiff} colorClass="text-amber-700" />
            <StatCard label="App Only" value={data.appOnly} colorClass="text-blue-700" />
            <StatCard label="Excel Only" value={data.excelOnly} colorClass="text-indigo-700" />
            <StatCard label="Disputed" value={data.disputed} colorClass="text-red-700" />
          </div>

          <ReconBreakdownTable
            title="By Vendor"
            nameHeader="Vendor"
            rows={data.byVendor.map((v) => ({
              name: v.vendorName,
              matched: v.matched,
              amountDiff: v.amountDiff,
              appOnly: v.appOnly,
              excelOnly: v.excelOnly,
            }))}
          />

          <ReconBreakdownTable
            title="By Department"
            nameHeader="Department"
            rows={data.byDepartment.map((d) => ({
              name: d.departmentName,
              matched: d.matched,
              amountDiff: d.amountDiff,
              appOnly: d.appOnly,
              excelOnly: d.excelOnly,
            }))}
          />
        </>
      )}
    </div>
  )
}

// ── Tab 2: Pending Invoices ────────────────────────────────────────────────────

function PendingInvoicesTab() {
  const [deptId, setDeptId] = useState('')

  const { data: deptsData } = useQuery<Department[]>({
    queryKey: ['departments-active'],
    queryFn: () => api.get('/departments').then((r) => r.data as Department[]),
  })
  const depts = deptsData ?? []

  const { data: invoices, isLoading, isError } = useQuery<PendingInvoice[]>({
    queryKey: ['pending-invoices', deptId],
    queryFn: () =>
      api
        .get('/reports/pending-invoices', {
          params: deptId ? { departmentId: deptId } : {},
        })
        .then((r) => r.data as PendingInvoice[]),
  })

  function handleExport() {
    if (!invoices) return
    exportToExcel('pending-invoices', ['Invoice No', 'Vendor', 'Department', 'Amount (₹)', 'Status', 'Days Pending'], invoices.map((inv) => [
      inv.invoiceNumber,
      inv.vendor.name,
      inv.department?.name ?? '—',
      inv.invoiceAmount,
      inv.status,
      inv.daysPending,
    ]))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Department</Label>
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className={cn(selectCls, 'min-w-[200px]')}
          >
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {invoices && invoices.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2 ml-auto self-end"
          >
            <FileSpreadsheet size={15} />
            Export Excel
          </Button>
        )}
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load pending invoices.
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground animate-pulse">
          Loading…
        </div>
      ) : invoices && invoices.length === 0 ? (
        <div className="rounded-md border px-6 py-14 text-center text-sm text-muted-foreground">
          No pending invoices.
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  {[
                    'Invoice No',
                    'Vendor',
                    'Department',
                    'Amount',
                    'Status',
                    'Days Pending',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(invoices ?? []).map((inv) => (
                  <tr
                    key={inv.id}
                    className={cn(
                      'border-b last:border-0 hover:bg-muted/30 transition-colors',
                      inv.daysPending > 60
                        ? 'bg-red-50/50'
                        : inv.daysPending > 30
                          ? 'bg-amber-50/50'
                          : '',
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2.5">{inv.vendor.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {inv.department?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{inr(inv.invoiceAmount)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 tabular-nums font-medium',
                        inv.daysPending > 60
                          ? 'text-red-700'
                          : inv.daysPending > 30
                            ? 'text-amber-700'
                            : '',
                      )}
                    >
                      {inv.daysPending}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 border border-amber-300" />
              &gt;30 days
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-100 border border-red-300" />
              &gt;60 days
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 3: Audit Log ──────────────────────────────────────────────────────────

function AuditLogTab() {
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const { data: usersData } = useQuery<{ data: User[] }>({
    queryKey: ['users-all'],
    queryFn: () =>
      api.get('/users', { params: { limit: 100 } }).then((r) => r.data as { data: User[] }),
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
  })
  const users = usersData?.data ?? []

  const params = {
    ...(userId ? { userId } : {}),
    ...(action.trim() ? { action: action.trim().toUpperCase() } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    page,
    limit: 20,
  }

  const { data, isLoading, isError } = useQuery<AuditLogResponse>({
    queryKey: ['audit-log', params],
    queryFn: () =>
      api.get('/reports/audit-log', { params }).then((r) => r.data as AuditLogResponse),
  })

  const pagination = data?.pagination

  function handleExport() {
    if (!data) return
    exportToExcel(
      'audit-log',
      ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP Address'],
      data.data.map((log) => [
        format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        log.user?.name ?? '—',
        log.action,
        log.entityType,
        log.entityId,
        log.ipAddress ?? '—',
      ]),
    )
  }

  function resetFilters() {
    setUserId('')
    setAction('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>User</Label>
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              setPage(1)
            }}
            className={cn(selectCls, 'min-w-[180px]')}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Action</Label>
          <input
            type="text"
            placeholder="e.g. CREATE"
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setPage(1)
            }}
            className={cn(selectCls, 'w-32')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(1)
            }}
            className={cn(selectCls, 'w-36')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(1)
            }}
            className={cn(selectCls, 'w-36')}
          />
        </div>
        {(userId || action || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="self-end">
            Clear
          </Button>
        )}
        {data && data.data.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2 ml-auto self-end"
          >
            <FileSpreadsheet size={15} />
            Export Excel
          </Button>
        )}
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load audit log.
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground animate-pulse">
          Loading…
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  {['Timestamp', 'User', 'Action', 'Entity', 'Details'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-10 text-center text-sm text-muted-foreground"
                    >
                      No log entries found.
                    </td>
                  </tr>
                ) : (
                  (data?.data ?? []).map((log) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.createdAt), 'dd MMM yy, HH:mm')}
                      </td>
                      <td className="px-3 py-2.5">
                        {log.user?.name ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs">
                        <span className="capitalize">
                          {log.entityType.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono text-muted-foreground/70 ml-1">
                          {log.entityId.slice(0, 8)}…
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[180px] truncate text-xs text-muted-foreground">
                        {log.ipAddress ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ·{' '}
                {pagination.total.toLocaleString()} entries
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'reconciliation', label: 'Reconciliation Summary' },
  { id: 'pending', label: 'Pending Invoices' },
  { id: 'audit', label: 'Audit Log' },
]

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reconciliation')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>

      {/* Tab bar */}
      <div className="border-b">
        <nav className="-mb-px flex gap-1" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'reconciliation' && <ReconciliationTab />}
      {activeTab === 'pending' && <PendingInvoicesTab />}
      {activeTab === 'audit' && <AuditLogTab />}
    </div>
  )
}
