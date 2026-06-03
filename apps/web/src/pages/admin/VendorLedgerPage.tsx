import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { format, subMonths } from 'date-fns'
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Printer,
  CheckCircle2,
  CreditCard,
  Receipt,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { exportToExcel } from '@/lib/exportToExcel'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

// ── Types ──────────────────────────────────────────────────────────────────────

interface VendorOption {
  id: string
  name: string
  isActive: boolean
  outstandingAmount: number
}

interface GrnItem {
  grnNumber: string
  grnAmount: number
  grnDate: string | null
  status: string
  paymentRef: string | null
  paymentDate: string | null
}

interface InvoiceItem {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: number
  status: string
  billType: string
  grns: GrnItem[]
  paymentRef: string | null
  paymentDate: string | null
}

interface PaymentItem {
  id: string
  paymentDate: string
  amount: number
  paymentMode: string
  transactionRef: string | null
  grnCount: number
}

interface MonthData {
  month: number
  year: number
  label: string
  openingBalance: number
  closingBalance: number
  monthTotalBilled: number
  monthTotalPaid: number
  invoices: InvoiceItem[]
  payments: PaymentItem[]
}

interface OpeningBalanceRecord {
  id: string
  vendorId: string
  hospitalId: string
  asOfDate: string
  amount: number
  notes: string | null
}

interface LedgerSummary {
  openingBalance: OpeningBalanceRecord | null
  totalBilled: number
  totalPaid: number
  totalReconciled: number
  totalOutstanding: number
  readyToPay: number
  needsReconciliation: number
  underReview: { count: number; amount: number }
  invoiceCount: number
}

interface LedgerResponse {
  summary: LedgerSummary
  transactionsByMonth: MonthData[]
  pendingUploadGrns: { count: number; totalAmount: number }
}

type Preset = 'last3' | 'last6' | 'thisYear' | 'custom'
type TxFilter = 'all' | 'invoices' | 'payments' | 'unpaid'

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  try {
    return format(new Date(d), 'dd MMM yyyy')
  } catch {
    return '—'
  }
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getPresetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  if (preset === 'last3') return { from: format(subMonths(today, 3), 'yyyy-MM-dd'), to: todayStr }
  if (preset === 'last6') return { from: format(subMonths(today, 6), 'yyyy-MM-dd'), to: todayStr }
  return { from: `${today.getFullYear()}-01-01`, to: todayStr }
}

const PAYMENT_MODE: Record<string, string> = {
  neft: 'NEFT',
  rtgs: 'RTGS',
  cheque: 'Cheque',
  cash: 'Cash',
}

const PRINT_STYLE = `
  @media print {
    body > *:not(#vlp-root) { display: none !important; }
    #vlp-root { display: block !important; }
    .vlp-no-print { display: none !important; }
    .vlp-print-header { display: block !important; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { border: 1px solid #ccc; padding: 4px 8px; }
    th { background: #f0f0f0; font-weight: 600; }
  }
`

// ── Sub-components ─────────────────────────────────────────────────────────────

function VendorCombobox({
  vendors,
  value,
  onChange,
}: {
  vendors: VendorOption[]
  value: string
  onChange: (id: string, name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = vendors.find((v) => v.id === value)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const filtered = useMemo(
    () =>
      search
        ? vendors.filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
        : vendors,
    [vendors, search],
  )

  return (
    <div ref={ref} className="relative min-w-[320px]">
      <input
        type="text"
        value={open ? search : (selected?.name ?? '')}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search vendor…"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No vendors found
            </div>
          ) : (
            filtered.map((v) => (
              <button
                key={v.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(v.id, v.name)
                  setSearch('')
                  setOpen(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-sm hover:bg-accent outline-none',
                  v.id === value && 'bg-accent/70 font-medium',
                )}
              >
                <span>{v.name}</span>
                {v.outstandingAmount > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    — {inr(v.outstandingAmount)} outstanding
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-green-600">— Cleared ✓</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function InvoiceStatusBadge({
  status,
  paymentRef,
}: {
  status: string
  paymentRef: string | null
}) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
        <CheckCircle2 size={13} className="shrink-0" />
        {paymentRef ? (
          <span className="font-mono">{paymentRef}</span>
        ) : (
          'Paid'
        )}
      </span>
    )
  }
  if (status === 'reconciled') {
    return (
      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
        Reconciled
      </span>
    )
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
        Approved
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground capitalize">
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function GrnInlineTable({ grns, invoiceId }: { grns: GrnItem[]; invoiceId: string }) {
  return (
    <div className="mt-1 rounded-md border bg-muted/10 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 border-b">
          <tr>
            {['GRN No.', 'GRN Date', 'Amount', 'Status'].map((h) => (
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
          {grns.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">
                No GRN entries
              </td>
            </tr>
          ) : (
            grns.map((g, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono">{g.grnNumber}</td>
                <td className="px-3 py-2">{fmtDate(g.grnDate)}</td>
                <td className="px-3 py-2 tabular-nums">{inr(g.grnAmount)}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      g.status === 'paid'
                        ? 'bg-green-100 text-green-800'
                        : g.status === 'reconciled'
                          ? 'bg-blue-100 text-blue-800'
                          : g.status === 'disputed'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {g.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="px-3 py-2 border-t">
        <button
          onClick={() => window.open(`/invoices/${invoiceId}`, '_blank')}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View Invoice <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function VendorLedgerPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeHospitalName } = useAuthStore()

  // Vendor selection
  const [selectedVendorId, setSelectedVendorId] = useState(searchParams.get('vendorId') ?? '')
  const [selectedVendorName, setSelectedVendorName] = useState('')

  // Date range
  const [preset, setPreset] = useState<Preset>('last3')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  // Loaded ledger state
  const [loadedParams, setLoadedParams] = useState<{
    vendorId: string
    dateFrom: string
    dateTo: string
  } | null>(null)

  // UI state
  const [txFilter, setTxFilter] = useState<TxFilter>('all')
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())

  // Opening balance modal
  const [obOpen, setObOpen] = useState(false)
  const [obDate, setObDate] = useState('')
  const [obAmount, setObAmount] = useState('')
  const [obNotes, setObNotes] = useState('')

  const autoLoaded = useRef(false)

  // ── Queries ──

  const { data: vendorsData, isLoading: vendorsLoading } = useQuery<{ data: VendorOption[] }>({
    queryKey: ['vendors-ledger-summary'],
    queryFn: () =>
      api.get('/vendors', { params: { limit: 500, withLedgerSummary: true } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const vendors = vendorsData?.data ?? []

  const ledgerQuery = useQuery<LedgerResponse>({
    queryKey: ['vendor-ledger', loadedParams],
    queryFn: () =>
      api
        .get('/reports/vendor-ledger', {
          params: {
            vendorId: loadedParams!.vendorId,
            dateFrom: loadedParams!.dateFrom,
            dateTo: loadedParams!.dateTo,
          },
        })
        .then((r) => r.data),
    enabled: Boolean(loadedParams),
    staleTime: 0,
  })

  const obMutation = useMutation({
    mutationFn: ({
      vendorId,
      asOfDate,
      amount,
      notes,
    }: {
      vendorId: string
      asOfDate: string
      amount: number
      notes?: string
    }) =>
      api
        .post(`/vendors/${vendorId}/opening-balance`, { asOfDate, amount, notes })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Opening balance saved')
      queryClient.invalidateQueries({ queryKey: ['vendor-ledger', loadedParams] })
      setObOpen(false)
    },
    onError: () => {
      toast.error('Failed to save opening balance')
    },
  })

  // ── Effects ──

  useEffect(() => {
    if (ledgerQuery.data) {
      const months = ledgerQuery.data.transactionsByMonth
      const toExpand = new Set<string>()
      if (months[0]) toExpand.add(monthKey(months[0].year, months[0].month))
      if (months[1]) toExpand.add(monthKey(months[1].year, months[1].month))
      setExpandedMonths(toExpand)
      setExpandedInvoices(new Set())
    }
  }, [ledgerQuery.data])

  useEffect(() => {
    const urlVendorId = searchParams.get('vendorId')
    if (autoLoaded.current || !urlVendorId || !vendorsData) return
    autoLoaded.current = true
    const vendor = vendorsData.data.find((v) => v.id === urlVendorId)
    if (vendor) {
      setSelectedVendorId(vendor.id)
      setSelectedVendorName(vendor.name)
      const range = getPresetRange('last3')
      setLoadedParams({ vendorId: vendor.id, dateFrom: range.from, dateTo: range.to })
    }
  }, [vendorsData, searchParams])

  // ── Handlers ──

  function handleLoad() {
    if (!selectedVendorId) return
    const range =
      preset !== 'custom'
        ? getPresetRange(preset)
        : { from: customFrom, to: customTo }
    if (!range.from || !range.to) {
      toast.error('Select a valid date range')
      return
    }
    setLoadedParams({ vendorId: selectedVendorId, dateFrom: range.from, dateTo: range.to })
  }

  function openObModal() {
    const ob = ledgerQuery.data?.summary.openingBalance
    if (ob) {
      setObDate(format(new Date(ob.asOfDate), 'yyyy-MM-dd'))
      setObAmount(String(ob.amount))
      setObNotes(ob.notes ?? '')
    } else {
      setObDate(format(new Date(), 'yyyy-MM-dd'))
      setObAmount('')
      setObNotes('')
    }
    setObOpen(true)
  }

  function handleObSave() {
    if (!loadedParams?.vendorId) return
    const amount = parseFloat(obAmount)
    if (!obDate || isNaN(amount)) {
      toast.error('Date and amount are required')
      return
    }
    obMutation.mutate({
      vendorId: loadedParams.vendorId,
      asOfDate: obDate,
      amount,
      notes: obNotes || undefined,
    })
  }

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleInvoice(id: string) {
    setExpandedInvoices((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExportExcel() {
    if (!ledgerQuery.data || !loadedParams) return
    const { transactionsByMonth, summary } = ledgerQuery.data
    const headers = [
      'Month',
      'Date',
      'Type',
      'Reference',
      'Debit (₹)',
      'Credit (₹)',
      'Running Balance (₹)',
    ]
    const rows: (string | number | null)[][] = []

    if (summary.openingBalance) {
      rows.push([
        'Opening Balance',
        format(new Date(summary.openingBalance.asOfDate), 'dd/MM/yyyy'),
        'Opening Balance',
        '',
        null,
        null,
        Number(summary.openingBalance.amount),
      ])
    }

    const chronological = [...transactionsByMonth].reverse()

    for (const m of chronological) {
      type TxRow = {
        date: Date
        type: 'invoice' | 'payment'
        debit: number
        credit: number
        ref: string
      }
      const txRows: TxRow[] = []

      for (const inv of m.invoices) {
        txRows.push({
          date: inv.invoiceDate
            ? new Date(inv.invoiceDate)
            : new Date(m.year, m.month - 1, 1),
          type: 'invoice',
          debit: inv.invoiceAmount,
          credit: 0,
          ref: inv.invoiceNumber,
        })
      }
      for (const pay of m.payments) {
        txRows.push({
          date: new Date(pay.paymentDate),
          type: 'payment',
          debit: 0,
          credit: pay.amount,
          ref: pay.transactionRef ?? '',
        })
      }
      txRows.sort((a, b) => a.date.getTime() - b.date.getTime())

      let balance = m.openingBalance
      for (const tx of txRows) {
        balance = balance + tx.debit - tx.credit
        rows.push([
          m.label,
          format(tx.date, 'dd/MM/yyyy'),
          tx.type === 'invoice' ? 'Invoice' : 'Payment',
          tx.ref,
          tx.debit > 0 ? tx.debit : null,
          tx.credit > 0 ? tx.credit : null,
          balance,
        ])
      }
    }

    exportToExcel(
      `vendor-ledger-${selectedVendorName}-${loadedParams.dateFrom}-to-${loadedParams.dateTo}`,
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

  // ── Derived state ──

  const filteredMonths = useMemo(() => {
    if (!ledgerQuery.data) return []
    return ledgerQuery.data.transactionsByMonth
      .map((m) => {
        let invoices = m.invoices
        let payments = m.payments
        if (txFilter === 'invoices') payments = []
        else if (txFilter === 'payments') invoices = []
        else if (txFilter === 'unpaid') {
          invoices = invoices.filter((inv) => inv.status !== 'paid')
          payments = []
        }
        return { ...m, visibleInvoices: invoices, visiblePayments: payments }
      })
      .filter((m) => m.visibleInvoices.length > 0 || m.visiblePayments.length > 0)
  }, [ledgerQuery.data, txFilter])

  const summary = ledgerQuery.data?.summary
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div id="vlp-root" className="flex flex-col gap-6 pb-20">
      {/* Print-only header */}
      <div className="vlp-print-header hidden">
        <h1 className="text-lg font-bold">{activeHospitalName} — Vendor Ledger</h1>
        {selectedVendorName && <p className="text-sm">Vendor: {selectedVendorName}</p>}
        {loadedParams && (
          <p className="text-sm">
            Period: {loadedParams.dateFrom} to {loadedParams.dateTo}
          </p>
        )}
      </div>

      {/* ── Page header ── */}
      <div className="flex items-center justify-between vlp-no-print">
        <h1 className="text-2xl font-bold tracking-tight">Vendor Ledger</h1>
        {ledgerQuery.data && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              className="gap-2"
            >
              <FileSpreadsheet size={14} />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer size={14} />
              Export PDF
            </Button>
          </div>
        )}
      </div>

      {/* ── Vendor selection + date range bar ── */}
      <div className="flex flex-wrap items-end gap-3 vlp-no-print">
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          {vendorsLoading ? (
            <div className="h-10 w-80 animate-pulse rounded-md bg-muted" />
          ) : (
            <VendorCombobox
              vendors={vendors}
              value={selectedVendorId}
              onChange={(id, name) => {
                setSelectedVendorId(id)
                setSelectedVendorName(name)
              }}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Date Range</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                ['last3', 'Last 3 Months'],
                ['last6', 'Last 6 Months'],
                ['thisYear', 'This Year'],
                ['custom', 'Custom'],
              ] as [Preset, string][]
            ).map(([p, label]) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={cn(
                  'h-10 rounded-md border px-3 text-sm transition-colors',
                  preset === p
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-10 w-36"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-10 w-36"
                />
              </div>
            )}
          </div>
        </div>

        <Button
          onClick={handleLoad}
          disabled={!selectedVendorId || ledgerQuery.isFetching}
          className="h-10"
        >
          {ledgerQuery.isFetching ? 'Loading…' : 'Load Ledger'}
        </Button>
      </div>

      {/* ── Empty state ── */}
      {!loadedParams && (
        <div className="rounded-md border px-6 py-16 text-center text-muted-foreground text-sm">
          Select a vendor and date range, then click Load Ledger.
        </div>
      )}

      {/* ── Error state ── */}
      {loadedParams && ledgerQuery.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load ledger data. Please try again.
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loadedParams && ledgerQuery.isLoading && (
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        </div>
      )}

      {/* ── Main ledger content ── */}
      {loadedParams && ledgerQuery.data && (
        <>
          {/* ── Summary card ── */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {/* Total Billed */}
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Billed
                </div>
                <div className="text-lg font-bold tabular-nums">{inr(summary!.totalBilled)}</div>
                <div className="text-xs text-muted-foreground">
                  {summary!.invoiceCount} invoice{summary!.invoiceCount !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Total Paid */}
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Paid
                </div>
                <div className="text-lg font-bold tabular-nums">{inr(summary!.totalPaid)}</div>
              </div>

              {/* Net Outstanding */}
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Net Outstanding
                </div>
                <div
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    summary!.totalOutstanding > 0 ? 'text-amber-700' : 'text-green-700',
                  )}
                >
                  {inr(summary!.totalOutstanding)}
                </div>
              </div>

              {/* Ready to Pay */}
              <div
                className={cn(
                  'rounded-md border p-3 space-y-1',
                  summary!.readyToPay > 0 && 'border-green-200 bg-green-50',
                )}
              >
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ready to Pay
                </div>
                <div
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    summary!.readyToPay > 0 && 'text-green-800',
                  )}
                >
                  {inr(summary!.readyToPay)}
                </div>
                {summary!.readyToPay > 0 && (
                  <button
                    onClick={() =>
                      navigate(`/admin/payments?vendorId=${loadedParams.vendorId}`)
                    }
                    className="text-xs font-medium text-green-700 hover:text-green-900 inline-flex items-center gap-1"
                  >
                    Pay Now <ArrowRight size={11} />
                  </button>
                )}
              </div>

              {/* Needs Reconciliation */}
              <div
                className={cn(
                  'rounded-md border p-3 space-y-1',
                  summary!.needsReconciliation > 0 && 'border-amber-200 bg-amber-50',
                )}
              >
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Needs Reconciliation
                </div>
                <div
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    summary!.needsReconciliation > 0 && 'text-amber-800',
                  )}
                >
                  {inr(summary!.needsReconciliation)}
                </div>
                {summary!.needsReconciliation > 0 && (
                  <button
                    onClick={() =>
                      navigate(
                        `/admin/reconciliation?vendorId=${loadedParams.vendorId}&month=${currentMonth}&year=${currentYear}`,
                      )
                    }
                    className="text-xs font-medium text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"
                  >
                    Reconcile <ArrowRight size={11} />
                  </button>
                )}
              </div>

              {/* Under Review */}
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Under Review
                </div>
                <div className="text-lg font-bold tabular-nums text-muted-foreground">
                  {inr(summary!.underReview.amount)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {summary!.underReview.count} invoice{summary!.underReview.count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* Opening balance row */}
            <div className="border-t pt-3 flex items-center gap-2 text-sm">
              {summary!.openingBalance ? (
                <>
                  <span className="text-muted-foreground">
                    Opening Balance as of{' '}
                    <strong>{fmtDate(summary!.openingBalance.asOfDate)}</strong>:{' '}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {inr(Number(summary!.openingBalance.amount))}
                  </span>
                  <button
                    onClick={openObModal}
                    className="ml-1 text-xs text-primary hover:underline vlp-no-print"
                  >
                    Edit
                  </button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">No opening balance set</span>
                  <button
                    onClick={openObModal}
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 vlp-no-print"
                  >
                    Add Opening Balance
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Transaction filter bar ── */}
          <div className="flex gap-2 vlp-no-print">
            {(
              [
                ['all', 'All'],
                ['invoices', 'Invoices Only'],
                ['payments', 'Payments Only'],
                ['unpaid', 'Unpaid Only'],
              ] as [TxFilter, string][]
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setTxFilter(f)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  txFilter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Month sections ── */}
          {filteredMonths.length === 0 ? (
            <div className="rounded-md border px-6 py-10 text-center text-sm text-muted-foreground">
              No transactions match the current filter.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMonths.map((m) => {
                const key = monthKey(m.year, m.month)
                const isExpanded = expandedMonths.has(key)
                const hasRows = m.visibleInvoices.length > 0 || m.visiblePayments.length > 0

                return (
                  <div key={key} className="rounded-lg border overflow-hidden">
                    {/* Month header */}
                    <button
                      type="button"
                      onClick={() => hasRows && toggleMonth(key)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold bg-muted/40 hover:bg-muted/60 transition-colors text-left',
                        !hasRows && 'cursor-default',
                      )}
                    >
                      <span className="text-muted-foreground w-4 shrink-0">
                        {isExpanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                      <span className="uppercase tracking-wide text-xs font-bold flex-1">
                        {m.label.toUpperCase()}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Billed:{' '}
                        <span className="font-medium text-foreground">
                          {inr(m.monthTotalBilled)}
                        </span>
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Paid:{' '}
                        <span className="font-medium text-foreground">
                          {inr(m.monthTotalPaid)}
                        </span>
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Closing Balance:{' '}
                        <span
                          className={cn(
                            'font-semibold',
                            m.closingBalance > 0 ? 'text-amber-700' : 'text-green-700',
                          )}
                        >
                          {inr(m.closingBalance)}
                        </span>
                      </span>
                    </button>

                    {/* Month rows */}
                    {isExpanded && (
                      <div className="divide-y">
                        {/* Invoice rows */}
                        {m.visibleInvoices.map((inv) => {
                          const invExpanded = expandedInvoices.has(inv.id)
                          return (
                            <div key={inv.id}>
                              <div
                                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 cursor-pointer"
                                onClick={() => toggleInvoice(inv.id)}
                              >
                                <span className="text-muted-foreground w-4 shrink-0">
                                  {invExpanded ? (
                                    <ChevronDown size={14} />
                                  ) : (
                                    <ChevronRight size={14} />
                                  )}
                                </span>
                                <Receipt size={14} className="text-muted-foreground shrink-0" />
                                <span className="font-mono text-sm font-medium min-w-[120px]">
                                  INV {inv.invoiceNumber}
                                </span>
                                <span className="text-xs text-muted-foreground min-w-[90px]">
                                  {fmtDate(inv.invoiceDate)}
                                </span>
                                <span className="tabular-nums text-sm font-semibold min-w-[100px]">
                                  {inr(inv.invoiceAmount)}
                                </span>
                                <div className="flex-1">
                                  <InvoiceStatusBadge
                                    status={inv.status}
                                    paymentRef={inv.paymentRef}
                                  />
                                </div>
                                {inv.status === 'reconciled' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      navigate(
                                        `/admin/payments?vendorId=${loadedParams.vendorId}`,
                                      )
                                    }}
                                    className="text-xs font-medium text-green-700 hover:text-green-900 border border-green-200 rounded px-2 py-0.5 bg-green-50 hover:bg-green-100 transition-colors vlp-no-print shrink-0"
                                  >
                                    Pay →
                                  </button>
                                )}
                              </div>
                              {invExpanded && (
                                <div className="px-12 pb-3">
                                  <GrnInlineTable grns={inv.grns} invoiceId={inv.id} />
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Payment rows */}
                        {m.visiblePayments.map((pay) => (
                          <div
                            key={pay.id}
                            className="flex items-center gap-3 px-4 py-3 bg-blue-50/60"
                          >
                            <span className="w-4 shrink-0" />
                            <CreditCard size={14} className="text-blue-600 shrink-0" />
                            <span className="font-semibold text-sm min-w-[120px] text-blue-800">
                              PAYMENT
                            </span>
                            <span className="text-xs text-muted-foreground min-w-[90px]">
                              {fmtDate(pay.paymentDate)}
                            </span>
                            <span className="tabular-nums text-sm font-semibold text-blue-800 min-w-[100px]">
                              -{inr(pay.amount)}
                            </span>
                            <span className="flex-1 text-xs text-muted-foreground">
                              {PAYMENT_MODE[pay.paymentMode] ?? pay.paymentMode}
                            </span>
                            {pay.transactionRef && (
                              <span className="font-mono text-xs text-muted-foreground shrink-0">
                                {pay.transactionRef}
                              </span>
                            )}
                          </div>
                        ))}

                        {/* Closing balance row */}
                        <div className="flex justify-end px-4 py-2 bg-muted/20 text-xs font-medium text-muted-foreground">
                          Closing Balance:{' '}
                          <span
                            className={cn(
                              'ml-2 font-bold tabular-nums',
                              m.closingBalance > 0 ? 'text-amber-700' : 'text-green-700',
                            )}
                          >
                            {inr(m.closingBalance)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Sticky bottom bar ── */}
      {loadedParams && ledgerQuery.data && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-lg border bg-background/95 backdrop-blur-sm px-4 py-3 shadow-md vlp-no-print">
          <div className="flex items-center gap-6 text-sm">
            <span>
              <span className="text-muted-foreground">Outstanding: </span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  summary!.totalOutstanding > 0 ? 'text-amber-700' : 'text-green-700',
                )}
              >
                {inr(summary!.totalOutstanding)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Ready to Pay: </span>
              <span className="font-bold tabular-nums text-green-700">
                {inr(summary!.readyToPay)}
              </span>
              {summary!.readyToPay > 0 && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => navigate(`/admin/payments?vendorId=${loadedParams.vendorId}`)}
                >
                  Pay Now →
                </Button>
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              className="gap-1.5 h-8 text-xs"
            >
              <FileSpreadsheet size={13} />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-1.5 h-8 text-xs"
            >
              <Printer size={13} />
              Export PDF
            </Button>
          </div>
        </div>
      )}

      {/* ── Opening balance modal ── */}
      <Dialog open={obOpen} onOpenChange={setObOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {ledgerQuery.data?.summary.openingBalance
                ? 'Edit Opening Balance'
                : 'Add Opening Balance'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-date">As of Date</Label>
              <Input
                id="ob-date"
                type="date"
                value={obDate}
                onChange={(e) => setObDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-amount">Amount (₹)</Label>
              <Input
                id="ob-amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={obAmount}
                onChange={(e) => setObAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-notes">Notes (optional)</Label>
              <Textarea
                id="ob-notes"
                rows={3}
                placeholder="e.g. Balance brought forward from previous system"
                value={obNotes}
                onChange={(e) => setObNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleObSave} disabled={obMutation.isPending}>
              {obMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
