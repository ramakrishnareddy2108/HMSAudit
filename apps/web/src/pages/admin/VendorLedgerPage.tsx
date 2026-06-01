import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { exportToExcel } from '@/lib/exportToExcel'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  name: string
  isActive: boolean
}

interface GrnBreakdownItem {
  grnNumber: string
  invoiceNumber: string
  amount: number
  status: string
  paymentRef: string | null
  paymentDate: string | null
}

interface LedgerMonth {
  month: number
  year: number
  invoiced: number
  reconciled: number
  paid: number
  pending: number
  grnBreakdown: GrnBreakdownItem[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

// ── Print CSS injected once ────────────────────────────────────────────────────

const PRINT_STYLE = `
  @media print {
    body > *:not(#vendor-ledger-print-root) { display: none !important; }
    #vendor-ledger-print-root { display: block !important; }
    .no-print { display: none !important; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: bold; }
    h1 { font-size: 16px; margin-bottom: 8px; }
    p { font-size: 11px; margin-bottom: 8px; }
  }
`

// ── GRN Status Badge ───────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'paid'
      ? 'bg-green-100 text-green-800'
      : status === 'reconciled'
        ? 'bg-blue-100 text-blue-800'
        : status === 'disputed'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', cls)}>
      {status}
    </span>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function VendorLedgerPage() {
  const [searchParams] = useSearchParams()
  const printRef = useRef<HTMLDivElement>(null)

  const [filterVendorId, setFilterVendorId] = useState(searchParams.get('vendorId') ?? '')
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR)
  const [loadedParams, setLoadedParams] = useState<{ vendorId: string; year: number } | null>(
    searchParams.get('vendorId')
      ? { vendorId: searchParams.get('vendorId')!, year: CURRENT_YEAR }
      : null,
  )
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set())

  // ── Queries ──

  const { data: vendorsData } = useQuery<{ data: Vendor[] }>({
    queryKey: ['vendors-all'],
    queryFn: () => api.get('/vendors', { params: { limit: 500 } }).then((r) => r.data),
  })
  const vendors = vendorsData?.data ?? []

  const ledgerQuery = useQuery<LedgerMonth[]>({
    queryKey: ['vendor-ledger', loadedParams],
    queryFn: () =>
      api
        .get('/reports/vendor-ledger', {
          params: { vendorId: loadedParams!.vendorId, year: loadedParams!.year },
        })
        .then((r) => r.data as LedgerMonth[]),
    enabled: Boolean(loadedParams),
  })

  // ── Derived: totals row ──

  const totals = useMemo<Omit<LedgerMonth, 'month' | 'year' | 'grnBreakdown'>>(() => {
    if (!ledgerQuery.data) return { invoiced: 0, reconciled: 0, paid: 0, pending: 0 }
    return ledgerQuery.data.reduce(
      (acc, row) => ({
        invoiced: acc.invoiced + row.invoiced,
        reconciled: acc.reconciled + row.reconciled,
        paid: acc.paid + row.paid,
        pending: acc.pending + row.pending,
      }),
      { invoiced: 0, reconciled: 0, paid: 0, pending: 0 },
    )
  }, [ledgerQuery.data])

  const selectedVendorName = vendors.find((v) => v.id === loadedParams?.vendorId)?.name ?? ''

  // ── Handlers ──

  function handleLoad() {
    if (!filterVendorId) return
    setLoadedParams({ vendorId: filterVendorId, year: filterYear })
    setExpandedMonths(new Set())
  }

  function toggleMonth(month: number) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  function handleExportExcel() {
    if (!ledgerQuery.data) return
    const headers = ['Month', 'Invoiced (₹)', 'Reconciled (₹)', 'Paid (₹)', 'Pending (₹)']
    const rows = ledgerQuery.data.map((row) => [
      MONTH_NAMES[row.month - 1] ?? '',
      row.invoiced,
      row.reconciled,
      row.paid,
      row.pending,
    ])
    rows.push(['Total', totals.invoiced, totals.reconciled, totals.paid, totals.pending])
    exportToExcel(
      `vendor-ledger-${selectedVendorName}-${loadedParams?.year}`,
      headers,
      rows,
    )
  }

  function handlePrint() {
    const style = document.createElement('style')
    style.textContent = PRINT_STYLE
    document.head.appendChild(style)
    window.print()
    document.head.removeChild(style)
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" id="vendor-ledger-print-root" ref={printRef}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vendor Ledger</h1>
        {ledgerQuery.data && (
          <div className="flex gap-2 no-print">
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-2">
              <FileSpreadsheet size={15} />
              Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
              <Printer size={15} />
              Export PDF
            </Button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 no-print">
        <div className="space-y-1.5 min-w-[240px]">
          <Label>Vendor</Label>
          <select
            value={filterVendorId}
            onChange={(e) => setFilterVendorId(e.target.value)}
            className={selectCls}
          >
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Year</Label>
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className={cn(selectCls, 'w-28')}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={handleLoad} disabled={!filterVendorId || ledgerQuery.isFetching}>
          {ledgerQuery.isFetching ? 'Loading…' : 'Load'}
        </Button>
      </div>

      {/* Print header (only visible on print) */}
      {loadedParams && (
        <div className="hidden print:block">
          <p className="text-sm text-muted-foreground">
            Vendor: <strong>{selectedVendorName}</strong> · Year: {loadedParams.year}
          </p>
        </div>
      )}

      {/* Ledger table */}
      {loadedParams && (
        <>
          {ledgerQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Failed to load ledger data. Please try again.
            </div>
          ) : ledgerQuery.isLoading ? (
            <div className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <>
              {/* Vendor / year heading */}
              <div className="flex items-baseline gap-3">
                <h2 className="font-semibold text-base">{selectedVendorName}</h2>
                <span className="text-muted-foreground text-sm">{loadedParams.year}</span>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground w-10" />
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Month
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Invoiced
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Reconciled
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Paid
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Pending
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerQuery.data!.map((row) => {
                      const isExpanded = expandedMonths.has(row.month)
                      const hasGrns = row.grnBreakdown.length > 0
                      return (
                        <>
                          <tr
                            key={row.month}
                            className={cn(
                              'border-b transition-colors',
                              hasGrns && 'cursor-pointer',
                              row.pending > 0
                                ? 'bg-amber-50/40 hover:bg-amber-50'
                                : row.invoiced > 0
                                  ? 'bg-green-50/20 hover:bg-green-50/40'
                                  : 'hover:bg-muted/30',
                            )}
                            onClick={() => hasGrns && toggleMonth(row.month)}
                          >
                            <td className="px-4 py-3 text-muted-foreground">
                              {hasGrns ? (
                                isExpanded ? (
                                  <ChevronDown size={14} />
                                ) : (
                                  <ChevronRight size={14} />
                                )
                              ) : null}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {MONTH_NAMES[row.month - 1]}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.invoiced > 0 ? inr(row.invoiced) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.reconciled > 0 ? inr(row.reconciled) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.paid > 0 ? inr(row.paid) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.pending > 0 ? (
                                <span className="font-medium text-amber-700">{inr(row.pending)}</span>
                              ) : row.invoiced > 0 ? (
                                <span className="text-green-700 font-medium">—</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>

                          {/* Expandable GRN breakdown */}
                          {isExpanded && hasGrns && (
                            <tr key={`${row.month}-breakdown`} className="border-b bg-muted/20">
                              <td colSpan={6} className="px-6 py-3">
                                <div className="rounded-md border overflow-x-auto bg-background">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/40 border-b">
                                      <tr>
                                        {[
                                          'GRN No.',
                                          'Invoice No.',
                                          'Amount',
                                          'Status',
                                          'Payment Ref',
                                          'Payment Date',
                                        ].map((h) => (
                                          <th
                                            key={h}
                                            className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wide"
                                          >
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.grnBreakdown.map((grn, i) => (
                                        <tr
                                          key={i}
                                          className="border-b last:border-0 hover:bg-muted/30"
                                        >
                                          <td className="px-3 py-2 font-mono">{grn.grnNumber}</td>
                                          <td className="px-3 py-2 font-mono">{grn.invoiceNumber}</td>
                                          <td className="px-3 py-2 tabular-nums">{inr(grn.amount)}</td>
                                          <td className="px-3 py-2">
                                            <StatusChip status={grn.status} />
                                          </td>
                                          <td className="px-3 py-2 font-mono text-muted-foreground">
                                            {grn.paymentRef ?? '—'}
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground">
                                            {grn.paymentDate
                                              ? format(new Date(grn.paymentDate), 'dd MMM yyyy')
                                              : '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 bg-muted/40">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 font-semibold text-sm">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {inr(totals.invoiced)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {inr(totals.reconciled)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {inr(totals.paid)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {totals.pending > 0 ? (
                          <span className="text-amber-700">{inr(totals.pending)}</span>
                        ) : (
                          <span className="text-green-700">{inr(0)}</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Legend */}
              <div className="flex gap-4 text-xs text-muted-foreground no-print">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 border border-amber-300" />
                  Pending balance
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-green-100 border border-green-300" />
                  Fully paid
                </span>
                <span className="text-muted-foreground">
                  Click a row to expand GRN breakdown.
                </span>
              </div>
            </>
          )}
        </>
      )}

      {!loadedParams && (
        <div className="rounded-md border px-6 py-16 text-center text-muted-foreground text-sm">
          Select a vendor and year, then click Load to view the ledger.
        </div>
      )}
    </div>
  )
}
