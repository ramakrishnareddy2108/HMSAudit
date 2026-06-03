import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  Play, RefreshCw, Trash2, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Search, ExternalLink, ZoomIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type MatchStatus = 'matched' | 'amount_diff' | 'grn_not_found' | 'invoice_only' | 'excel_only'
type Resolution = 'accepted_app' | 'accepted_excel' | 'accepted_partial' | 'disputed' | 'not_required' | 'pending_upload' | 'sent_back' | 'override_valid' | 'auto_matched'
type TabKey = 'needs_action' | 'matched' | 'amount_diff' | 'grn_not_found' | 'invoice_only' | 'excel_only' | 'all'

interface ReconciliationRun {
  id: string
  periodMonth: number
  periodYear: number
  status: 'running' | 'completed'
  totalMatched: number
  totalAmountDiff: number
  totalAppOnly: number
  totalExcelOnly: number
  createdAt: string
  completedAt: string | null
  runner: { id: string; name: string }
}

interface ReconResult {
  id: string
  reconRunId: string
  grnEntryId: string | null
  grnMasterId: string | null
  matchStatus: MatchStatus
  appAmount: string | null
  excelAmount: string | null
  resolution: Resolution | null
  adminNote: string | null
  resolvedAt: string | null
  createdAt: string
  grnEntry: {
    id: string
    grnNumber: string
    grnAmount: string
    grnDate: string | null
    status: string
    invoice: {
      id: string
      invoiceNumber: string
      invoiceDate: string | null
      invoiceAmount: string
      fileUrl: string | null
      createdAt: string
      vendor: { id: string; name: string }
      uploader: { id: string; name: string }
    }
  } | null
  grnMaster: {
    id: string
    grnNumber: string
    grnAmount: string
    grnDate: string | null
    invoiceNumber: string | null
    vendor: { id: string; name: string } | null
    rawExcelData: Record<string, unknown> | null
  } | null
  resolver: { id: string; name: string } | null
}

interface ResultsCounts {
  matched: number
  amount_diff: number
  grn_not_found: number
  invoice_only: number
  excel_only: number
  needs_action: number
  resolved: number
  total_non_matched: number
}

interface ResultsResponse {
  data: ReconResult[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  counts: ResultsCounts
  excelOnlyStats?: { totalCount: number; totalAmount: string }
}

interface RunsResponse {
  data: ReconciliationRun[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface GrnSearchRow {
  id: string
  grnNumber: string
  invoiceNumber: string | null
  grnDate: string | null
  grnAmount: string
  vendor: { id: string; name: string } | null
  poNumber: unknown
  isMatched: boolean
}

type ApiError = { response?: { data?: { error?: string } } }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function fmt(n: string | number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
}

function grnNumber(r: ReconResult) { return r.grnEntry?.grnNumber ?? r.grnMaster?.grnNumber ?? '—' }
function vendorName(r: ReconResult) { return r.grnEntry?.invoice.vendor.name ?? r.grnMaster?.vendor?.name ?? '—' }
function vendorId(r: ReconResult) { return r.grnEntry?.invoice.vendor.id ?? r.grnMaster?.vendor?.id ?? null }
function invoiceNo(r: ReconResult) { return r.grnEntry?.invoice.invoiceNumber ?? '—' }
function grnDate(r: ReconResult) {
  const d = r.grnEntry?.grnDate ?? r.grnMaster?.grnDate
  return d ? format(new Date(d), 'dd MMM yyyy') : '—'
}
function diff(r: ReconResult): number | null {
  if (r.appAmount === null || r.excelAmount === null) return null
  return Number(r.appAmount) - Number(r.excelAmount)
}

function StatusBadge({ status }: { status: MatchStatus }) {
  const map: Record<MatchStatus, string> = {
    matched: 'bg-green-100 text-green-800',
    amount_diff: 'bg-amber-100 text-amber-800',
    grn_not_found: 'bg-red-100 text-red-800',
    invoice_only: 'bg-orange-100 text-orange-800',
    excel_only: 'bg-blue-100 text-blue-800',
  }
  const label: Record<MatchStatus, string> = {
    matched: 'Matched', amount_diff: 'Amount Diff',
    grn_not_found: 'GRN Not Found', invoice_only: 'Invoice Only', excel_only: 'Excel Only',
  }
  return <Badge className={cn('hover:opacity-100', map[status])}>{label[status]}</Badge>
}

function ResolutionBadge({ resolution }: { resolution: Resolution }) {
  const map: Record<Resolution, [string, string]> = {
    auto_matched:     ['bg-green-100 text-green-800', 'Auto Matched'],
    accepted_app:     ['bg-green-100 text-green-800', 'Accepted App'],
    accepted_excel:   ['bg-green-100 text-green-800', 'Accepted Excel'],
    accepted_partial: ['bg-green-100 text-green-800', 'Accepted Partial'],
    disputed:         ['bg-red-100 text-red-800', 'Disputed'],
    not_required:     ['bg-gray-100 text-gray-700', 'Not Required'],
    pending_upload:   ['bg-orange-100 text-orange-800', 'Pending Upload'],
    sent_back:        ['bg-red-100 text-red-800', 'Sent Back'],
    override_valid:   ['bg-indigo-100 text-indigo-800', 'Override Valid'],
  }
  const [cls, label] = map[resolution]
  return <Badge className={cn('hover:opacity-100', cls)}>{label}</Badge>
}

// ── Summary Bar ───────────────────────────────────────────────────────────────

function SummaryBar({ counts }: { counts: ResultsCounts | undefined }) {
  if (!counts) return null
  const resolved = counts.resolved
  const total = counts.total_non_matched
  return (
    <div className="sticky top-0 z-20 bg-background border-b flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-sm shadow-sm">
      <span className="flex items-center gap-1.5 text-green-700 font-medium">
        <CheckCircle2 size={15} /> Matched <strong>{counts.matched}</strong>
      </span>
      <span className="flex items-center gap-1.5 text-amber-700 font-medium">
        <AlertTriangle size={15} /> Amount Diff <strong>{counts.amount_diff}</strong>
      </span>
      <span className="flex items-center gap-1.5 text-red-700 font-medium">
        <XCircle size={15} /> GRN Not Found <strong>{counts.grn_not_found}</strong>
      </span>
      <span className="flex items-center gap-1.5 text-orange-700 font-medium">
        <XCircle size={15} /> Invoice Only <strong>{counts.invoice_only}</strong>
      </span>
      <span className="flex items-center gap-1.5 text-blue-700 font-medium">
        <XCircle size={15} /> Excel Only <strong>{counts.excel_only}</strong>
      </span>
      <span className="ml-auto text-muted-foreground">
        Resolved <strong className="text-foreground">{resolved}</strong>/<strong className="text-foreground">{total}</strong>
      </span>
    </div>
  )
}

// ── App Side Panel ────────────────────────────────────────────────────────────

function AppSide({ result, onImageOpen }: { result: ReconResult; onImageOpen: (url: string) => void }) {
  const inv = result.grnEntry?.invoice
  const entry = result.grnEntry
  if (!entry || !inv) return <p className="text-sm text-muted-foreground italic">No app-side data.</p>

  const rows: [string, React.ReactNode][] = [
    ['Vendor', inv.vendor.name],
    ['Invoice No', <span key="inv" className="font-mono">{inv.invoiceNumber}</span>],
    ['Invoice Date', inv.invoiceDate ? format(new Date(inv.invoiceDate), 'dd MMM yyyy') : '—'],
    ['Invoice Amount', fmt(inv.invoiceAmount)],
    ['GRN Number', <span key="grn" className="font-mono">{entry.grnNumber}</span>],
    ['GRN Amount', fmt(entry.grnAmount)],
    ['GRN Date', entry.grnDate ? format(new Date(entry.grnDate), 'dd MMM yyyy') : '—'],
    ['Uploaded by', `${inv.uploader.name} on ${format(new Date(inv.createdAt), 'dd MMM yyyy')}`],
  ]

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App Side</p>
      <dl className="space-y-2">
        {rows.map(([label, val]) => (
          <div key={label} className="grid grid-cols-[140px_1fr] gap-2 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium break-all">{val}</dd>
          </div>
        ))}
      </dl>
      {inv.fileUrl && (
        <button
          type="button"
          onClick={() => onImageOpen(inv.fileUrl!)}
          className="mt-3 flex items-center gap-2 w-full rounded border p-2 text-sm hover:bg-muted/50 transition-colors text-left"
        >
          <img
            src={inv.fileUrl}
            alt="Invoice thumbnail"
            className="h-14 w-14 object-cover rounded shrink-0"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
          <span className="text-muted-foreground text-xs flex items-center gap-1">
            <ZoomIn size={12} /> View Invoice Image
          </span>
        </button>
      )}
    </div>
  )
}

// ── Excel Side Panel ──────────────────────────────────────────────────────────

function ExcelSide({ result, highlightMismatch }: { result: ReconResult; highlightMismatch?: boolean }) {
  const master = result.grnMaster
  if (!master) return <p className="text-sm text-muted-foreground italic">No Excel-side data.</p>

  const raw = master.rawExcelData ?? {}
  const amtDiff = highlightMismatch && result.appAmount !== null && result.excelAmount !== null
    && Math.abs(Number(result.appAmount) - Number(result.excelAmount)) > 0.01

  const rows: [string, React.ReactNode, boolean?][] = [
    ['Vendor', master.vendor?.name ?? '—'],
    ['Invoice No', <span key="inv" className="font-mono">{master.invoiceNumber ?? '—'}</span>],
    ['GRN Number', <span key="grn" className="font-mono">{master.grnNumber}</span>],
    ['GRN Amount', fmt(master.grnAmount), amtDiff],
    ['GRN Date', master.grnDate ? format(new Date(master.grnDate), 'dd MMM yyyy') : '—'],
    ['PO Number', String(raw['PO Number'] ?? raw['po_number'] ?? raw['poNumber'] ?? '—')],
    ['DC Number', String(raw['DC Number'] ?? raw['dc_number'] ?? raw['dcNumber'] ?? '—')],
    ['Qty Ordered', String(raw['Qty Ordered'] ?? raw['qty_ordered'] ?? '—')],
    ['Qty Received', String(raw['Qty Received'] ?? raw['qty_received'] ?? '—')],
    ['Payment Type', String(raw['Cash/Credit'] ?? raw['cash_or_credit'] ?? '—')],
    ['Stores Location', String(raw['Stores Location'] ?? raw['stores_location'] ?? '—')],
  ]

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Excel Side</p>
      <dl className="space-y-2">
        {rows.map(([label, val, highlight]) => (
          <div
            key={label}
            className={cn(
              'grid grid-cols-[140px_1fr] gap-2 text-sm rounded px-1',
              highlight && 'bg-red-50 text-red-700',
            )}
          >
            <dt className={highlight ? 'text-red-600' : 'text-muted-foreground'}>{label}</dt>
            <dd className="font-medium break-all">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── GRN Lookup Tool ───────────────────────────────────────────────────────────

interface GrnLookupToolProps {
  result: ReconResult
  onUseGrn: (newGrnNumber: string) => void
  isPending: boolean
}

function GrnLookupTool({ result, onUseGrn, isPending }: GrnLookupToolProps) {
  const [search, setSearch] = useState('')
  const vendName = vendorName(result)
  const vid = vendorId(result)
  const appAmt = result.appAmount
  const invNo = result.grnEntry?.invoice.invoiceNumber

  const searchQuery = useQuery<{ data: GrnSearchRow[] }>({
    queryKey: ['grn-search', vid, search],
    queryFn: () =>
      api.get('/grn-sync/search', { params: { vendorId: vid, search } }).then((r) => r.data),
    enabled: search.trim().length >= 2,
  })

  const rows = searchQuery.data?.data ?? []

  return (
    <div className="space-y-3 rounded-md border p-4 bg-muted/30">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        GRN Lookup — Find from purchase records
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Vendor (pre-filled)</Label>
          <Input value={vendName} readOnly className="bg-muted text-sm h-8" />
        </div>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-sm"
          placeholder="Search GRN No, Invoice No, or Amount (min 2 chars)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {search.trim().length >= 2 && (
        <div className="rounded border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b bg-muted/40">
              <tr>
                {['GRN Number', 'Invoice No', 'GRN Date', 'Amount', 'PO No', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {searchQuery.isLoading ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Searching…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No matching GRNs found.</td></tr>
              ) : rows.map((row) => {
                const amtMatch = appAmt !== null && Math.abs(Number(row.grnAmount) - Number(appAmt)) <= 0.01
                const invMatch = invNo && row.invoiceNumber?.toLowerCase() === invNo.toLowerCase()
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b last:border-0',
                      amtMatch && 'bg-green-50',
                      invMatch && !amtMatch && 'bg-blue-50',
                    )}
                  >
                    <td className="px-3 py-2 font-mono">{row.grnNumber}</td>
                    <td className="px-3 py-2 font-mono">{row.invoiceNumber ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.grnDate ? format(new Date(row.grnDate), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(row.grnAmount)}</td>
                    <td className="px-3 py-2">{String(row.poNumber ?? '—')}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        disabled={isPending}
                        onClick={() => onUseGrn(row.grnNumber)}
                      >
                        Use This GRN
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Resolve Drawer ────────────────────────────────────────────────────────────

interface ResolveDrawerProps {
  result: ReconResult | null
  runId: string | null
  onClose: () => void
  onRefresh: () => void
}

function ResolveDrawer({ result, runId, onClose, onRefresh }: ResolveDrawerProps) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [imageExpanded, setImageExpanded] = useState(false)
  const [drawerResult, setDrawerResult] = useState<ReconResult | null>(null)

  useEffect(() => {
    setDrawerResult(result)
    setNote('')
    setImageExpanded(false)
  }, [result])

  const active = drawerResult

  const resolveMutation = useMutation({
    mutationFn: ({ resolution }: { resolution: string }) =>
      api.post(`/reconciliation/runs/${runId}/results/${active!.id}/resolve`, {
        resolution,
        adminNote: note,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recon-results'] })
      onRefresh()
      onClose()
      toast.success('Resolved')
    },
    onError: (err: unknown) => {
      toast.error((err as ApiError).response?.data?.error ?? 'Failed to resolve')
    },
  })

  const fixGrnMutation = useMutation({
    mutationFn: (newGrnNumber: string) =>
      api.post(`/reconciliation/results/${active!.id}/fix-grn`, { newGrnNumber }).then((r) => r.data),
    onSuccess: (updated: ReconResult) => {
      if (updated.matchStatus === 'matched') {
        queryClient.invalidateQueries({ queryKey: ['recon-results'] })
        onRefresh()
        onClose()
        toast.success('GRN fixed — auto matched')
      } else {
        setDrawerResult(updated)
        toast.success(`GRN updated — now ${updated.matchStatus.replace('_', ' ')}`)
      }
    },
    onError: (err: unknown) => {
      toast.error((err as ApiError).response?.data?.error ?? 'Failed to fix GRN')
    },
  })

  const canSubmit = note.trim().length > 0 && !resolveMutation.isPending && !fixGrnMutation.isPending

  if (!active) return null

  const ms = active.matchStatus
  const appAmt = active.appAmount
  const excelAmt = active.excelAmount

  return (
    <Sheet open={Boolean(result)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full sm:max-w-3xl flex flex-col overflow-hidden p-0"
        side="right"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            {ms === 'grn_not_found' && <AlertTriangle size={16} className="text-red-500" />}
            {ms === 'matched' ? 'Matched' : 'Resolve'} — {grnNumber(active)}
            <span className="ml-1">
              <StatusBadge status={ms} />
            </span>
          </SheetTitle>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

          {/* AMOUNT_DIFF: two-column layout */}
          {ms === 'amount_diff' && (
            <>
              <div className="grid grid-cols-2 gap-6">
                <AppSide result={active} onImageOpen={(url) => { window.open(url, '_blank') }} />
                <div className="space-y-3">
                  <ExcelSide result={active} highlightMismatch />
                  <div className="rounded-md border p-3 bg-red-50 text-center">
                    <p className="text-xs text-red-600 mb-0.5">Difference</p>
                    <p className="text-base font-bold text-red-700 tabular-nums">
                      {diff(active) !== null
                        ? (diff(active)! > 0 ? '+' : '') + fmt(diff(active))
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
              {imageExpanded && active.grnEntry?.invoice.fileUrl && (
                <img
                  src={active.grnEntry.invoice.fileUrl}
                  alt="Invoice"
                  className="w-full rounded border object-contain max-h-96"
                />
              )}
              {active.grnEntry?.invoice.fileUrl && !imageExpanded && (
                <button
                  type="button"
                  onClick={() => setImageExpanded(true)}
                  className="flex items-center gap-2 text-xs text-primary hover:underline"
                >
                  <ZoomIn size={12} /> Expand invoice image
                </button>
              )}
            </>
          )}

          {/* GRN_NOT_FOUND */}
          {ms === 'grn_not_found' && (
            <>
              <AppSide result={active} onImageOpen={(url) => window.open(url, '_blank')} />
              <p className="text-sm text-muted-foreground bg-red-50 border border-red-200 rounded-md px-4 py-3">
                This GRN number was not found in the purchase Excel records.
                Use the lookup tool below to find the correct GRN.
              </p>
              <GrnLookupTool
                result={active}
                isPending={fixGrnMutation.isPending}
                onUseGrn={(grn) => fixGrnMutation.mutate(grn)}
              />
            </>
          )}

          {/* INVOICE_ONLY */}
          {ms === 'invoice_only' && (
            <>
              <div className="grid grid-cols-2 gap-6">
                <AppSide result={active} onImageOpen={(url) => window.open(url, '_blank')} />
                <ExcelSide result={active} highlightMismatch />
              </div>
              <GrnLookupTool
                result={active}
                isPending={fixGrnMutation.isPending}
                onUseGrn={(grn) => fixGrnMutation.mutate(grn)}
              />
            </>
          )}

          {/* EXCEL_ONLY */}
          {ms === 'excel_only' && (
            <>
              <p className="text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded-md px-4 py-3">
                No invoice has been uploaded for this GRN. Department staff need to upload it.
              </p>
              <ExcelSide result={active} />
            </>
          )}

          {/* Admin note */}
          <div className="space-y-1.5">
            <Label>
              Admin Note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain the reason for your decision…"
              rows={3}
            />
          </div>
        </div>

        {/* Footer buttons */}
        <div className="px-6 py-4 border-t shrink-0 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={resolveMutation.isPending}>
            Cancel
          </Button>

          {ms === 'amount_diff' && (
            <>
              <Button
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'disputed' })}
              >
                Mark Disputed
              </Button>
              <Button
                variant="outline"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'accepted_excel' })}
              >
                Accept Excel {excelAmt !== null ? fmt(excelAmt) : ''}
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'accepted_app' })}
              >
                Accept App {appAmt !== null ? fmt(appAmt) : ''}
              </Button>
            </>
          )}

          {(ms === 'grn_not_found' || ms === 'invoice_only') && (
            <>
              <Button
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'disputed' })}
              >
                Mark Disputed
              </Button>
              {ms === 'invoice_only' && (
                <Button
                  variant="outline"
                  disabled={!canSubmit}
                  onClick={() => resolveMutation.mutate({ resolution: 'accepted_partial' })}
                >
                  Accept Partial Match
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'override_valid' })}
              >
                Override as Valid
              </Button>
              <Button
                variant="destructive"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'sent_back' })}
              >
                Send Back to Staff
              </Button>
            </>
          )}

          {ms === 'excel_only' && (
            <>
              <Button
                variant="outline"
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'not_required' })}
              >
                Not Required
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() => resolveMutation.mutate({ resolution: 'pending_upload' })}
              >
                Mark as Pending Upload
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Vendor Group Table ────────────────────────────────────────────────────────

interface VendorGroupProps {
  vendorName: string
  vendorId: string | null
  rows: ReconResult[]
  onResolve: (r: ReconResult) => void
}

function VendorGroup({ vendorName: vName, vendorId: vId, rows, onResolve }: VendorGroupProps) {
  const appTotal = rows.reduce((s, r) => s + (r.appAmount ? Number(r.appAmount) : 0), 0)
  const excelTotal = rows.reduce((s, r) => s + (r.excelAmount ? Number(r.excelAmount) : 0), 0)

  return (
    <Fragment>
      {/* vendor header row */}
      <tr className="bg-muted/60 border-b">
        <td colSpan={9} className="px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm flex items-center gap-1.5">
              {vId ? (
                <Link
                  to={`/admin/ledger?vendorId=${vId}`}
                  className="hover:underline text-primary flex items-center gap-1"
                >
                  {vName} <ExternalLink size={12} />
                </Link>
              ) : vName}
            </span>
            <span className="text-xs text-muted-foreground">
              {rows.length} GRN{rows.length !== 1 ? 's' : ''}
            </span>
          </div>
        </td>
      </tr>

      {/* data rows */}
      {rows.map((r) => {
        const d = diff(r)
        const isMatched = r.matchStatus === 'matched'
        const isResolved = r.resolution !== null
        return (
          <tr
            key={r.id}
            className={cn(
              'border-b last:border-b transition-colors hover:bg-muted/20',
              isMatched && 'bg-green-50/60',
            )}
          >
            <td className="px-4 py-3 font-mono text-sm">{grnNumber(r)}</td>
            <td className="px-4 py-3 text-sm">{vName}</td>
            <td className="px-4 py-3 font-mono text-sm">{invoiceNo(r)}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{grnDate(r)}</td>
            <td className="px-4 py-3 tabular-nums text-sm">{fmt(r.appAmount)}</td>
            <td className="px-4 py-3 tabular-nums text-sm">{fmt(r.excelAmount)}</td>
            <td className={cn('px-4 py-3 tabular-nums text-sm', d !== null && d !== 0 && 'text-red-600 font-medium')}>
              {d !== null ? (d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)) : '—'}
            </td>
            <td className="px-4 py-3">
              {isResolved
                ? <ResolutionBadge resolution={r.resolution!} />
                : <StatusBadge status={r.matchStatus} />}
            </td>
            <td className="px-4 py-3 text-right">
              {!isMatched && !isResolved && (
                <Button size="sm" variant="outline" onClick={() => onResolve(r)}>
                  Resolve
                </Button>
              )}
            </td>
          </tr>
        )
      })}

      {/* subtotal row */}
      <tr className="bg-muted/30 border-b">
        <td colSpan={4} className="px-4 py-2 text-xs text-muted-foreground">
          Subtotal — {rows.length} GRN{rows.length !== 1 ? 's' : ''}
        </td>
        <td className="px-4 py-2 tabular-nums text-xs font-medium">{fmt(appTotal)}</td>
        <td className="px-4 py-2 tabular-nums text-xs font-medium">{fmt(excelTotal)}</td>
        <td colSpan={3} />
      </tr>
    </Fragment>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const now = new Date()
  const queryClient = useQueryClient()

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('needs_action')
  const [resultPage, setResultPage] = useState(1)
  const [drawerResult, setDrawerResult] = useState<ReconResult | null>(null)
  const [freshConfirmOpen, setFreshConfirmOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [hasSetInitialRun, setHasSetInitialRun] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  const runsQuery = useQuery<RunsResponse>({
    queryKey: ['recon-runs'],
    queryFn: () => api.get('/reconciliation/runs', { params: { limit: 100 } }).then((r) => r.data),
  })

  const grnSyncCheck = useQuery<{ data: Array<{ status: string }> }>({
    queryKey: ['grn-sync-check'],
    queryFn: () => api.get('/grn-sync/runs', { params: { limit: 100 } }).then((r) => r.data),
  })

  const hasUnresolvedConflicts =
    grnSyncCheck.data?.data.some((r) => r.status === 'has_conflicts') ?? false

  // Set initial run on first load
  useEffect(() => {
    if (!hasSetInitialRun && runsQuery.data?.data.length) {
      setActiveRunId(runsQuery.data.data[0].id)
      setHasSetInitialRun(true)
    }
  }, [runsQuery.data, hasSetInitialRun])

  // Reset page when tab or run changes
  useEffect(() => { setResultPage(1) }, [activeTab, activeRunId])

  const resultsQuery = useQuery<ResultsResponse>({
    queryKey: ['recon-results', activeRunId, activeTab, resultPage],
    queryFn: () => {
      const params: Record<string, string | number> = { page: resultPage, limit: 50 }
      if (activeTab === 'needs_action') {
        params.needsAction = 'true'
      } else if (activeTab !== 'all') {
        params.matchStatus = activeTab
      }
      return api.get(`/reconciliation/runs/${activeRunId}/results`, { params }).then((r) => r.data)
    },
    enabled: Boolean(activeRunId),
  })

  const runMutation = useMutation({
    mutationFn: ({ month, year, force }: { month: number; year: number; force: boolean }) =>
      api.post('/reconciliation/run', { month, year, force }).then((r) => r.data),
    onSuccess: (data: { runId: string }) => {
      setActiveRunId(data.runId)
      queryClient.invalidateQueries({ queryKey: ['recon-runs'] })
      queryClient.invalidateQueries({ queryKey: ['recon-results'] })
      setActiveTab('needs_action')
      toast.success('Reconciliation complete')
    },
    onError: (err: unknown) => {
      const e = err as ApiError
      toast.error(e.response?.data?.error ?? 'Reconciliation failed')
    },
  })

  const runs = runsQuery.data?.data ?? []
  const activeRun = runs.find((r) => r.id === activeRunId)
  const completedRunForPeriod = runs.find(
    (r) => r.periodMonth === selectedMonth && r.periodYear === selectedYear && r.status === 'completed',
  )
  const runningRunForPeriod = runs.find(
    (r) => r.periodMonth === selectedMonth && r.periodYear === selectedYear && r.status === 'running',
  )

  const counts = resultsQuery.data?.counts
  const results = resultsQuery.data?.data ?? []
  const yearRange = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i)

  const TABS: { key: TabKey; label: string; count: number | undefined }[] = [
    { key: 'needs_action', label: 'Needs Action', count: counts?.needs_action },
    { key: 'matched', label: 'Matched', count: counts?.matched },
    { key: 'amount_diff', label: 'Amount Diff', count: counts?.amount_diff },
    { key: 'grn_not_found', label: 'GRN Not Found', count: counts?.grn_not_found },
    { key: 'invoice_only', label: 'Invoice Only', count: counts?.invoice_only },
    { key: 'excel_only', label: 'Excel Only', count: counts?.excel_only },
    { key: 'all', label: 'All', count: counts
        ? counts.matched + counts.amount_diff + counts.grn_not_found + counts.invoice_only + counts.excel_only
        : undefined },
  ]

  // Group results by vendor
  const groups = useMemo(() => {
    const map = new Map<string, { vendorName: string; vendorId: string | null; rows: ReconResult[] }>()
    for (const r of results) {
      const vName = vendorName(r)
      const vId = vendorId(r)
      if (!map.has(vName)) map.set(vName, { vendorName: vName, vendorId: vId, rows: [] })
      map.get(vName)!.rows.push(r)
    }
    return Array.from(map.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName))
  }, [results])

  const footerAppTotal = results.reduce((s, r) => s + (r.appAmount ? Number(r.appAmount) : 0), 0)
  const footerExcelTotal = results.reduce((s, r) => s + (r.excelAmount ? Number(r.excelAmount) : 0), 0)

  function refreshResults() {
    queryClient.invalidateQueries({ queryKey: ['recon-results', activeRunId] })
    queryClient.invalidateQueries({ queryKey: ['recon-runs'] })
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* ── Top bar ── */}
      <div className="px-6 py-5 border-b space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Reconciliation</h1>

        {hasUnresolvedConflicts && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Unresolved GRN conflicts detected. Resolve them in{' '}
              <a href="/admin/grn-sync" className="underline font-medium">GRN Sync</a>{' '}
              before running reconciliation.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="r-month">Month</Label>
            <select
              id="r-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-year">Year</Label>
            <select
              id="r-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {yearRange.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {completedRunForPeriod ? (
            <>
              <Button
                variant="outline"
                disabled={runMutation.isPending || hasUnresolvedConflicts}
                onClick={() => runMutation.mutate({ month: selectedMonth, year: selectedYear, force: false })}
              >
                {runMutation.isPending ? (
                  <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Running…</>
                ) : (
                  <><RefreshCw size={15} className="mr-1.5" />Update — keep resolutions</>
                )}
              </Button>
              <Button
                variant="destructive"
                disabled={runMutation.isPending || hasUnresolvedConflicts}
                onClick={() => setFreshConfirmOpen(true)}
              >
                <Trash2 size={15} className="mr-1.5" />Fresh Run — reset all
              </Button>
            </>
          ) : (
            <Button
              disabled={runMutation.isPending || hasUnresolvedConflicts || Boolean(runningRunForPeriod)}
              onClick={() => runMutation.mutate({ month: selectedMonth, year: selectedYear, force: false })}
            >
              {runMutation.isPending ? (
                <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Running…</>
              ) : (
                <><Play size={15} className="mr-1.5" />Run Reconciliation</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ── Summary bar (sticky) ── */}
      {activeRunId && <SummaryBar counts={counts} />}

      {/* ── Results area ── */}
      {activeRunId && (
        <div ref={resultsRef} className="px-6 py-5 space-y-4">
          {/* Run label */}
          {activeRun && (
            <p className="text-sm text-muted-foreground">
              Showing:{' '}
              <span className="font-medium text-foreground">
                {MONTHS[activeRun.periodMonth - 1]} {activeRun.periodYear}
              </span>
              {' '}· Run {format(new Date(activeRun.createdAt), 'dd MMM yyyy')} by {activeRun.runner?.name}
              {' '}<Badge variant="secondary" className="ml-1">{activeRun.status}</Badge>
            </p>
          )}

          {/* Tabs */}
          <div className="flex flex-wrap gap-1 border-b pb-3">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground',
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={cn(
                    'ml-1.5 text-xs rounded-full px-1.5 py-0.5',
                    activeTab === tab.key ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                    tab.key === 'needs_action' && tab.count > 0 && activeTab !== tab.key
                      ? 'bg-red-100 text-red-700' : '',
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {['GRN Number', 'Vendor', 'Invoice No', 'GRN Date', 'App Amount', 'Excel Amount', 'Difference', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultsQuery.isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">Loading results…</td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      {activeTab === 'needs_action' ? 'No items need action.' : 'No results in this category.'}
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <VendorGroup
                      key={g.vendorName}
                      vendorName={g.vendorName}
                      vendorId={g.vendorId}
                      rows={g.rows}
                      onResolve={(r) => setDrawerResult(r)}
                    />
                  ))
                )}
              </tbody>

              {/* Footer */}
              {results.length > 0 && (
                <tfoot className="border-t bg-muted/50">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-xs text-muted-foreground font-medium">
                      {results.length} item{results.length !== 1 ? 's' : ''} (this page)
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs font-semibold">{fmt(footerAppTotal)}</td>
                    <td className="px-4 py-3 tabular-nums text-xs font-semibold">{fmt(footerExcelTotal)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {resultsQuery.data && resultsQuery.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {resultPage} of {resultsQuery.data.pagination.totalPages} · {resultsQuery.data.pagination.total} total
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={resultPage === 1}
                  onClick={() => setResultPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline"
                  disabled={resultPage === resultsQuery.data.pagination.totalPages}
                  onClick={() => setResultPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History section (collapsed) ── */}
      <div className="px-6 py-4 border-t mt-auto">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors"
        >
          {historyOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Reconciliation History
          <span className="text-xs font-normal text-muted-foreground">
            ({runsQuery.data?.pagination.total ?? 0} runs)
          </span>
        </button>

        {historyOpen && (
          <div className="mt-4 rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {['Period', 'Run Date', 'Run By', 'Matched', 'Unresolved', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runsQuery.isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : runs.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No runs yet.</td></tr>
                ) : runs.map((run) => (
                  <tr
                    key={run.id}
                    className={cn(
                      'border-b last:border-0 hover:bg-muted/30 transition-colors',
                      run.id === activeRunId && 'bg-muted/40',
                    )}
                  >
                    <td className="px-4 py-3 font-medium">
                      {MONTHS[run.periodMonth - 1]} {run.periodYear}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(run.createdAt), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-4 py-3">{run.runner?.name ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-green-700 font-medium">{run.totalMatched}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {run.totalAmountDiff + run.totalAppOnly + run.totalExcelOnly}
                    </td>
                    <td className="px-4 py-3">
                      {run.status === 'completed'
                        ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>
                        : <Badge variant="secondary">Running</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={run.id === activeRunId ? 'secondary' : 'ghost'}
                        onClick={() => {
                          setActiveRunId(run.id)
                          setActiveTab('needs_action')
                          resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
                        }}
                      >
                        {run.id === activeRunId ? 'Viewing' : 'View'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Resolve Drawer ── */}
      <ResolveDrawer
        result={drawerResult}
        runId={activeRunId}
        onClose={() => setDrawerResult(null)}
        onRefresh={refreshResults}
      />

      {/* ── Fresh Run Confirm ── */}
      <Dialog open={freshConfirmOpen} onOpenChange={(o) => !o && setFreshConfirmOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-destructive" />
              Reset All Resolutions?
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="space-y-2 text-sm">
            <p>
              This will delete all results for{' '}
              {MONTHS[selectedMonth - 1]} {selectedYear} and run a fresh reconciliation from scratch.
            </p>
            <p className="text-destructive font-medium text-xs">This cannot be undone.</p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreshConfirmOpen(false)} disabled={runMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={runMutation.isPending}
              onClick={() => {
                setFreshConfirmOpen(false)
                runMutation.mutate({ month: selectedMonth, year: selectedYear, force: true })
              }}
            >
              {runMutation.isPending ? 'Running…' : 'Confirm Fresh Run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
