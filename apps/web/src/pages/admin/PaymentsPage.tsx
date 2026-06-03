import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  MailCheck,
  MailX,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Eye,
  CircleSlash,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface VendorOption {
  id: string
  name: string
  isActive: boolean
  outstandingAmount: number
}

interface GrnInGroup {
  id: string
  grnNumber: string
  grnAmount: number
  paidAmount: number
  remainingAmount: number
  isPartiallyPaid: boolean
  grnDate: string | null
  invoiceId: string
  invoice: {
    invoiceNumber: string
    invoiceDate: string | null
    invoiceAmount: number
  }
}

interface MonthGroup {
  month: number
  year: number
  label: string
  grns: GrnInGroup[]
  groupTotal: number
}

interface VendorInfo {
  id: string
  name: string
  email: string | null
  contactName: string | null
}

interface EligibleGrnsResponse {
  vendor: VendorInfo
  monthlyGroups: MonthGroup[]
  totalOutstanding: number
  disputedGroups?: MonthGroup[]
  totalDisputedAmount?: number
}

interface AllocationResult {
  fullyPaidGrns: Array<{ grnId: string; grnNumber: string; allocatedAmount: number; invoiceNo: string }>
  partialGrn: {
    grnId: string
    grnNumber: string
    allocatedAmount: number
    totalAmount: number
    remaining: number
    invoiceNo: string
  } | null
  excludedGrns: Array<{ grnId: string; grnNumber: string; amount: number; invoiceNo: string }>
  totalAllocated: number
  isExactMatch: boolean
}

interface Payment {
  id: string
  vendorId: string
  periodMonth: number
  periodYear: number
  totalAmount: string
  paymentDate: string
  paymentMode: string
  transactionRef: string | null
  remarks: string | null
  emailSent: boolean
  emailSentAt: string | null
  createdAt: string
  vendor: { id: string; name: string; email: string | null }
  _count: { paymentGrns: number }
}

interface PaymentDetail {
  id: string
  totalAmount: string
  paymentDate: string
  paymentMode: string
  transactionRef: string | null
  remarks: string | null
  emailSent: boolean
  emailSentAt: string | null
  createdAt: string
  vendor: {
    id: string
    name: string
    email: string | null
    contactName: string | null
    phone: string | null
  }
  paymentGrns: Array<{
    amountPaid: string
    isPartial: boolean
    grn: {
      grnNumber: string
      grnAmount: string
      invoice: { id: string; invoiceNumber: string; invoiceAmount: string; status: string }
    }
  }>
}

interface PaymentListResponse {
  data: Payment[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface InvoiceForSheet {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: string
  billType: 'grn_bill' | 'miscellaneous'
  status: string
  fileUrl: string | null
  fileType: 'image' | 'pdf' | null
  vendor: { name: string }
  department: { name: string } | null
  grnEntries: Array<{
    id: string
    grnNumber: string
    grnAmount: string
    grnDate: string | null
    status: string
  }>
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PAYMENT_MODES = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
] as const

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function modeLabel(mode: string): string {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode.toUpperCase()
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  try {
    return format(new Date(d), 'dd MMM yyyy')
  } catch {
    return '—'
  }
}

function buildEmailHtml(params: {
  vendorName: string
  amount: number
  date: string
  mode: string
  transactionRef?: string | null
  grns: Array<{ grnNumber: string; invoiceNumber: string; amount: number }>
}): string {
  const { vendorName, amount, date, mode, transactionRef, grns } = params
  const grnRows = grns
    .map(
      (g) =>
        `<tr>` +
        `<td style="padding:6px 12px;border:1px solid #ddd;">${g.grnNumber}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ddd;">${g.invoiceNumber}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ddd;text-align:right;">${inr(g.amount)}</td>` +
        `</tr>`,
    )
    .join('')
  return `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;color:#333;">
  <p>Dear ${vendorName},</p>
  <p>Payment of <strong>${inr(amount)}</strong> confirmed on <strong>${format(new Date(date), 'dd MMM yyyy')}</strong> via <strong>${modeLabel(mode)}</strong>.${transactionRef ? ` Ref: <strong>${transactionRef}</strong>.` : ''}</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">GRN No.</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Invoice No.</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${grnRows}</tbody>
    <tfoot>
      <tr style="background:#f5f5f5;font-weight:bold;">
        <td colspan="2" style="padding:8px 12px;border:1px solid #ddd;">Total</td>
        <td style="padding:8px 12px;border:1px solid #ddd;text-align:right;">${inr(amount)}</td>
      </tr>
    </tfoot>
  </table>
  <p>Regards,<br/><strong>Hospital Billing Team</strong></p>
</div>`
}

function buildDefaultEmailBody(params: {
  vendorName: string
  amount: number
  date: string
  mode: string
  transactionRef?: string | null
  grns: Array<{ grnNumber: string; invoiceNumber: string; amount: number }>
}): string {
  const { vendorName, amount, date, mode, transactionRef, grns } = params
  const grnLines = grns
    .map((g) => `  ${g.grnNumber} | ${g.invoiceNumber} | ${inr(g.amount)}`)
    .join('\n')
  return `Dear ${vendorName},

Payment of ${inr(amount)} confirmed on ${format(new Date(date), 'dd MMM yyyy')} via ${modeLabel(mode)}.${transactionRef ? `\nTransaction Reference: ${transactionRef}` : ''}

GRN Details:
${grnLines}

Regards,
Hospital Billing Team`
}

// ── Payment form schema ────────────────────────────────────────────────────────

const paymentSchema = z.object({
  paymentDate: z.string().min(1, 'Date is required'),
  paymentMode: z.enum(['neft', 'rtgs', 'cheque', 'cash']),
  transactionRef: z.string().optional(),
  remarks: z.string().optional(),
})
type PaymentFormValues = z.infer<typeof paymentSchema>

// ── VendorCombobox ─────────────────────────────────────────────────────────────

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

// ── InvoiceDetailSheet ─────────────────────────────────────────────────────────

function InvoiceDetailSheet({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useQuery<InvoiceForSheet>({
    queryKey: ['invoice-sheet', invoiceId],
    queryFn: () => api.get(`/invoices/${invoiceId}`).then((r) => r.data),
    enabled: Boolean(invoiceId),
    staleTime: 5 * 60_000,
  })

  const grnTotal = data?.grnEntries.reduce((sum, g) => sum + parseFloat(g.grnAmount), 0) ?? 0

  return (
    <Sheet open={Boolean(invoiceId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Invoice Details</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : !data ? (
          <div className="mt-6 text-center text-destructive text-sm py-12">
            Failed to load invoice.
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {data.fileUrl && data.fileType === 'image' && (
              <div className="rounded-lg border overflow-hidden bg-muted">
                <img
                  src={data.fileUrl}
                  alt="Invoice"
                  className="w-full object-contain max-h-64"
                />
              </div>
            )}
            {data.fileUrl && data.fileType === 'pdf' && (
              <a
                href={data.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink size={14} />
                View PDF
              </a>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                <p className="font-medium">{data.vendor.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invoice No.</p>
                <p className="font-mono">{data.invoiceNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="font-semibold">{inr(parseFloat(data.invoiceAmount))}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p>{fmtDate(data.invoiceDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant="secondary" className="capitalize text-xs">
                  {data.status.replace(/_/g, ' ')}
                </Badge>
              </div>
              {data.department && (
                <div>
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p>{data.department.name}</p>
                </div>
              )}
            </div>

            {data.billType === 'grn_bill' && data.grnEntries.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  GRN Entries ({data.grnEntries.length})
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        {['GRN No.', 'Date', 'Amount', 'Status'].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-medium uppercase tracking-wide text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.grnEntries.map((g) => (
                        <tr key={g.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono">{g.grnNumber}</td>
                          <td className="px-3 py-2">{fmtDate(g.grnDate)}</td>
                          <td className="px-3 py-2 tabular-nums">{inr(parseFloat(g.grnAmount))}</td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                g.status === 'paid'
                                  ? 'bg-green-100 text-green-800'
                                  : g.status === 'partial_paid'
                                    ? 'bg-amber-100 text-amber-800'
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
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/20">
                      <tr>
                        <td
                          colSpan={2}
                          className="px-3 py-2 text-xs font-medium text-muted-foreground"
                        >
                          Total
                        </td>
                        <td className="px-3 py-2 tabular-nums font-medium">{inr(grnTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── PaymentDetailSheet ─────────────────────────────────────────────────────────

function PaymentDetailSheet({
  paymentId,
  onClose,
}: {
  paymentId: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [showResend, setShowResend] = useState(false)
  const [resendBody, setResendBody] = useState('')

  const { data, isLoading } = useQuery<PaymentDetail>({
    queryKey: ['payment-detail', paymentId],
    queryFn: () => api.get(`/payments/${paymentId}`).then((r) => r.data as PaymentDetail),
    enabled: Boolean(paymentId),
  })

  useEffect(() => {
    if (data) {
      setResendBody(
        buildDefaultEmailBody({
          vendorName: data.vendor.name,
          amount: Number(data.totalAmount),
          date: data.paymentDate,
          mode: data.paymentMode,
          transactionRef: data.transactionRef,
          grns: data.paymentGrns.map((pg) => ({
            grnNumber: pg.grn.grnNumber,
            invoiceNumber: pg.grn.invoice.invoiceNumber,
            amount: Number(pg.amountPaid),
          })),
        }),
      )
    }
  }, [data])

  const resendMutation = useMutation({
    mutationFn: ({ id, emailBody }: { id: string; emailBody: string }) =>
      api.post(`/payments/${id}/resend-email`, { emailBody }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payment-detail', paymentId] })
      toast.success('Email resent successfully')
      setShowResend(false)
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to resend email'
      toast.error(msg)
    },
  })

  return (
    <Sheet open={Boolean(paymentId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Payment Details</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="mt-6 py-12 text-center text-muted-foreground text-sm">Loading…</div>
        ) : !data ? (
          <div className="mt-6 py-12 text-center text-destructive text-sm">
            Failed to load payment.
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                <p className="font-medium">{data.vendor.name}</p>
                {data.vendor.email && (
                  <p className="text-xs text-muted-foreground">{data.vendor.email}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="font-semibold text-base">{inr(Number(data.totalAmount))}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment Date</p>
                <p>{fmtDate(data.paymentDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Mode</p>
                <p>{modeLabel(data.paymentMode)}</p>
              </div>
              {data.transactionRef && (
                <div>
                  <p className="text-xs text-muted-foreground">Transaction Ref</p>
                  <p className="font-mono text-xs">{data.transactionRef}</p>
                </div>
              )}
              {data.remarks && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p>{data.remarks}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Email Status</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {data.emailSent ? (
                    <>
                      <MailCheck size={14} className="text-green-600" />
                      <span className="text-green-700 text-xs">
                        Sent{data.emailSentAt ? ` ${fmtDate(data.emailSentAt)}` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <MailX size={14} className="text-muted-foreground" />
                      <span className="text-muted-foreground text-xs">Not sent</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                GRN Breakdown ({data.paymentGrns.length})
              </p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {['GRN No.', 'Invoice No.', 'Amount Paid', ''].map((h) => (
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
                    {data.paymentGrns.map((pg, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2.5 font-mono text-xs">{pg.grn.grnNumber}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {pg.grn.invoice.invoiceNumber}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{inr(Number(pg.amountPaid))}</td>
                        <td className="px-3 py-2.5">
                          {pg.isPartial && (
                            <Badge variant="outline" className="text-amber-700 border-amber-400 text-xs">
                              Partial
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {data.vendor.email && (
              <div className="pt-1">
                {!showResend ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowResend(true)}
                    className="gap-2"
                  >
                    <RefreshCw size={14} />
                    Resend Email
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label className="text-xs">Email Body</Label>
                    <Textarea
                      value={resendBody}
                      onChange={(e) => setResendBody(e.target.value)}
                      rows={8}
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          resendMutation.mutate({ id: data.id, emailBody: resendBody })
                        }
                        disabled={resendMutation.isPending}
                      >
                        {resendMutation.isPending ? 'Sending…' : 'Send'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowResend(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── EmailPreviewDialog ─────────────────────────────────────────────────────────

function EmailPreviewDialog({
  open,
  emailHtml,
  emailBody,
  onEmailBodyChange,
  onClose,
}: {
  open: boolean
  emailHtml: string
  emailBody: string
  onEmailBodyChange: (v: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email Preview</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Preview
            </p>
            <div
              className="rounded-md border bg-white p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: emailHtml }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Customize Email Body</Label>
            <p className="text-xs text-muted-foreground">
              Edit the plain-text body below. This overrides the default template.
            </p>
            <Textarea
              value={emailBody}
              onChange={(e) => onEmailBodyChange(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── ConfirmPaymentDialog ───────────────────────────────────────────────────────

function ConfirmPaymentDialog({
  open,
  vendorName,
  vendorEmail,
  amount,
  grnCount,
  sendEmail,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean
  vendorName: string
  vendorEmail: string | null
  amount: number
  grnCount: number
  sendEmail: boolean
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Payment</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2 text-sm">
          <p>
            Confirm payment of{' '}
            <span className="font-semibold">{inr(amount)}</span> to{' '}
            <span className="font-semibold">{vendorName}</span>?
          </p>
          <p className="text-muted-foreground">
            {grnCount} GRN{grnCount !== 1 ? 's' : ''} will be marked as paid.
          </p>
          {sendEmail && vendorEmail ? (
            <p className="text-muted-foreground">
              Payment email will be sent to{' '}
              <span className="font-medium text-foreground">{vendorEmail}</span>.
            </p>
          ) : (
            <p className="text-muted-foreground">No email will be sent.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Processing…' : 'Confirm Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── AllocationPreview ──────────────────────────────────────────────────────────

function AllocationPreview({ allocation }: { allocation: AllocationResult }) {
  const { fullyPaidGrns, partialGrn, excludedGrns } = allocation
  const excludedTotal = excludedGrns.reduce((s, g) => s + g.amount, 0)

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
        Payment Allocation Preview
      </p>
      <div className="space-y-1">
        {fullyPaidGrns.map((g) => (
          <div key={g.grnId} className="flex items-center gap-2 text-xs text-green-800">
            <span className="text-green-600 font-bold">✓</span>
            <span className="font-mono">{g.grnNumber}</span>
            <span className="text-muted-foreground">(Invoice {g.invoiceNo})</span>
            <span className="ml-auto font-medium tabular-nums">{inr(g.allocatedAmount)} fully paid</span>
          </div>
        ))}
        {partialGrn && (
          <div className="flex items-center gap-2 text-xs text-amber-800">
            <CircleSlash size={11} className="text-amber-600 shrink-0" />
            <span className="font-mono">{partialGrn.grnNumber}</span>
            <span className="text-muted-foreground">(Invoice {partialGrn.invoiceNo})</span>
            <span className="ml-auto font-medium tabular-nums">
              {inr(partialGrn.allocatedAmount)} of {inr(partialGrn.totalAmount)} (partial)
            </span>
          </div>
        )}
        {excludedGrns.map((g) => (
          <div key={g.grnId} className="flex items-center gap-2 text-xs text-muted-foreground line-through">
            <span className="text-destructive font-bold">✗</span>
            <span className="font-mono">{g.grnNumber}</span>
            <span>(Invoice {g.invoiceNo})</span>
            <span className="ml-auto tabular-nums">{inr(g.amount)} excluded</span>
          </div>
        ))}
      </div>

      {excludedGrns.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 mt-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {inr(excludedTotal)} across {excludedGrns.length} GRN{excludedGrns.length !== 1 ? 's' : ''} will not be
            included in this payment. They remain available for future payments.
          </span>
        </div>
      )}

      {partialGrn && fullyPaidGrns.length === 0 && excludedGrns.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Payment amount is less than {partialGrn.grnNumber} ({inr(partialGrn.totalAmount)}).{' '}
            {partialGrn.grnNumber} will receive a partial payment of{' '}
            {inr(partialGrn.allocatedAmount)}. All other selected GRNs have been excluded.
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoLoaded = useRef(false)

  // ── Vendor selection ──
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [selectedVendorName, setSelectedVendorName] = useState('')
  const [loadedVendorId, setLoadedVendorId] = useState<string | null>(null)

  // ── GRN selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [includedDisputedIds, setIncludedDisputedIds] = useState<Set<string>>(new Set())
  const [disputedOpen, setDisputedOpen] = useState(false)

  // ── Payment amount + allocation ──
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [allocation, setAllocation] = useState<AllocationResult | null>(null)
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [amountError, setAmountError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Email toggle ──
  const [sendEmail, setSendEmail] = useState(true)

  // ── Sheet state ──
  const [invoiceSheetId, setInvoiceSheetId] = useState<string | null>(null)
  const [paymentSheetId, setPaymentSheetId] = useState<string | null>(null)

  // ── Email + confirm dialogs ──
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailBody, setEmailBody] = useState('')
  const [emailHtml, setEmailHtml] = useState('')
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)

  // ── Success state ──
  const [successPayment, setSuccessPayment] = useState<{
    id: string
    amount: number
    email: string | null
    vendorName: string
    emailSent: boolean
  } | null>(null)

  // ── History filters ──
  const [histPage, setHistPage] = useState(1)
  const [histVendorId, setHistVendorId] = useState('')
  const [histMonth, setHistMonth] = useState('')
  const [histYear, setHistYear] = useState(String(CURRENT_YEAR))

  // ── Resend from history ──
  const [resendingId, setResendingId] = useState<string | null>(null)

  // ── Form ──
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      paymentMode: 'neft',
      transactionRef: '',
      remarks: '',
    },
  })
  const paymentDate = useWatch({ control: form.control, name: 'paymentDate' })
  const paymentMode = useWatch({ control: form.control, name: 'paymentMode' })

  // ── Queries ──

  const { data: vendorsData, isLoading: vendorsLoading } = useQuery<{ data: VendorOption[] }>({
    queryKey: ['vendors-payments-summary'],
    queryFn: () =>
      api.get('/vendors', { params: { limit: 500, withLedgerSummary: true } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const vendors: VendorOption[] = vendorsData?.data ?? []

  const eligibleQuery = useQuery<EligibleGrnsResponse>({
    queryKey: ['eligible-grns', loadedVendorId],
    queryFn: () =>
      api
        .get('/payments/eligible-grns', {
          params: { vendorId: loadedVendorId, includeDisputed: true },
        })
        .then((r) => r.data as EligibleGrnsResponse),
    enabled: Boolean(loadedVendorId),
    staleTime: 0,
  })

  const historyQuery = useQuery<PaymentListResponse>({
    queryKey: ['payments', histPage, histVendorId, histMonth, histYear],
    queryFn: () =>
      api
        .get('/payments', {
          params: {
            page: histPage,
            limit: 20,
            ...(histVendorId ? { vendorId: histVendorId } : {}),
            ...(histMonth ? { month: Number(histMonth) } : {}),
            ...(histYear ? { year: Number(histYear) } : {}),
          },
        })
        .then((r) => r.data as PaymentListResponse),
  })

  // ── Auto-load from URL param ──
  useEffect(() => {
    const urlVendorId = searchParams.get('vendorId')
    if (autoLoaded.current || !urlVendorId || !vendorsData) return
    autoLoaded.current = true
    const vendor = vendorsData.data.find((v) => v.id === urlVendorId)
    if (vendor) {
      setSelectedVendorId(vendor.id)
      setSelectedVendorName(vendor.name)
      setLoadedVendorId(vendor.id)
    }
  }, [vendorsData, searchParams])

  // ── Derived state ──

  const sortedGroups: MonthGroup[] = useMemo(() => {
    if (!eligibleQuery.data?.monthlyGroups) return []
    return [...eligibleQuery.data.monthlyGroups].reverse()
  }, [eligibleQuery.data])

  const sortedDisputedGroups: MonthGroup[] = useMemo(() => {
    if (!eligibleQuery.data?.disputedGroups) return []
    return [...eligibleQuery.data.disputedGroups].reverse()
  }, [eligibleQuery.data])

  const allReconciled = useMemo(
    () => sortedGroups.flatMap((g) => g.grns),
    [sortedGroups],
  )
  const allDisputed = useMemo(
    () => sortedDisputedGroups.flatMap((g) => g.grns),
    [sortedDisputedGroups],
  )

  // Total of selected GRNs (using remainingAmount for partially paid)
  const selectedTotal = useMemo(() => {
    let total = 0
    allReconciled.forEach((g) => { if (selectedIds.has(g.id)) total += g.remainingAmount })
    allDisputed.forEach((g) => { if (includedDisputedIds.has(g.id)) total += g.remainingAmount })
    return total
  }, [allReconciled, allDisputed, selectedIds, includedDisputedIds])

  // IDs eligible for allocation (excludes GRNs that allocation says to exclude)
  const effectiveSelectedIds = useMemo(() => {
    if (!allocation) return selectedIds
    const excludedSet = new Set(allocation.excludedGrns.map((g) => g.grnId))
    return new Set([...selectedIds].filter((id) => !excludedSet.has(id)))
  }, [allocation, selectedIds])

  const selectedCount = effectiveSelectedIds.size + includedDisputedIds.size

  const selectedInvoiceCount = useMemo(() => {
    const ids = new Set<string>()
    allReconciled.forEach((g) => { if (effectiveSelectedIds.has(g.id)) ids.add(g.invoiceId) })
    allDisputed.forEach((g) => { if (includedDisputedIds.has(g.id)) ids.add(g.invoiceId) })
    return ids.size
  }, [allReconciled, allDisputed, effectiveSelectedIds, includedDisputedIds])

  const selectedMonthCount = useMemo(() => {
    const keys = new Set<string>()
    sortedGroups.forEach((g) => {
      if (g.grns.some((grn) => effectiveSelectedIds.has(grn.id))) keys.add(`${g.year}-${g.month}`)
    })
    sortedDisputedGroups.forEach((g) => {
      if (g.grns.some((grn) => includedDisputedIds.has(grn.id))) keys.add(`${g.year}-${g.month}`)
    })
    return keys.size
  }, [sortedGroups, sortedDisputedGroups, effectiveSelectedIds, includedDisputedIds])

  const hasGrns =
    eligibleQuery.isSuccess &&
    (sortedGroups.length > 0 || sortedDisputedGroups.length > 0)

  // Effective payment amount
  const effectivePaymentAmount = useMemo(() => {
    const parsed = parseFloat(paymentAmountInput)
    if (!paymentAmountInput || isNaN(parsed)) return selectedTotal
    return parsed
  }, [paymentAmountInput, selectedTotal])

  const canConfirm = Boolean(
    loadedVendorId && selectedCount > 0 && paymentDate && paymentMode && !amountError,
  )

  // ── Allocation fetch (debounced) ──

  const fetchAllocation = useCallback(
    async (amount: number, grnIds: string[]) => {
      if (!loadedVendorId || grnIds.length === 0) return
      setAllocationLoading(true)
      try {
        const res = await api.post('/payments/calculate-allocation', {
          vendorId: loadedVendorId,
          grnIds,
          paymentAmount: amount,
        })
        setAllocation(res.data as AllocationResult)
      } catch {
        // silently ignore allocation errors
      } finally {
        setAllocationLoading(false)
      }
    },
    [loadedVendorId],
  )

  // Re-run allocation whenever amount input or selection changes
  useEffect(() => {
    const selected = [...selectedIds]
    if (selected.length === 0) {
      setAllocation(null)
      setAmountError(null)
      return
    }

    const parsed = parseFloat(paymentAmountInput)
    if (!paymentAmountInput || isNaN(parsed) || parsed <= 0) {
      setAllocation(null)
      setAmountError(null)
      return
    }

    if (parsed > selectedTotal + 0.01) {
      setAmountError('Amount exceeds selected GRNs total')
      setAllocation(null)
      return
    }
    setAmountError(null)

    if (Math.abs(parsed - selectedTotal) < 0.01) {
      // Exact match — no need to call API
      setAllocation(null)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchAllocation(parsed, selected)
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [paymentAmountInput, selectedIds, selectedTotal, fetchAllocation])

  // Reset amount when vendor / selection cleared
  useEffect(() => {
    setPaymentAmountInput('')
    setAllocation(null)
    setAmountError(null)
  }, [loadedVendorId])

  // ── Mutation ──

  const createPaymentMutation = useMutation({
    mutationFn: (body: {
      vendorId: string
      grnIds: string[]
      includeDisputedIds?: string[]
      paymentDate: string
      paymentMode: string
      transactionRef?: string
      remarks?: string
      emailBody?: string
      sendEmail: boolean
      grnAllocations?: Array<{ grnId: string; amountPaid: number; isPartial: boolean }>
    }) => api.post('/payments', body),
    onSuccess: (response) => {
      const payment = response.data as { id: string; totalAmount: string; emailSent: boolean }
      setSuccessPayment({
        id: payment.id,
        amount: Number(payment.totalAmount),
        email: eligibleQuery.data?.vendor.email ?? null,
        vendorName: eligibleQuery.data?.vendor.name ?? '',
        emailSent: payment.emailSent,
      })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['eligible-grns'] })
      queryClient.invalidateQueries({ queryKey: ['vendors-payments-summary'] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to record payment'
      toast.error(msg)
    },
  })

  const resendEmailMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payments/${id}/resend-email`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      toast.success('Email sent successfully')
      setResendingId(null)
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to send email'
      toast.error(msg)
      setResendingId(null)
    },
  })

  // ── Handlers ──

  function handleLoad() {
    if (!selectedVendorId) {
      toast.error('Select a vendor first')
      return
    }
    setLoadedVendorId(selectedVendorId)
    setSelectedIds(new Set())
    setIncludedDisputedIds(new Set())
    setSuccessPayment(null)
    setEmailBody('')
    setAllocation(null)
    setPaymentAmountInput('')
    setSendEmail(true)
  }

  function selectAll() {
    setSelectedIds(new Set(allReconciled.map((g) => g.id)))
  }

  function clearAll() {
    setSelectedIds(new Set())
  }

  function toggleGrn(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleMonth(group: MonthGroup) {
    const groupIds = group.grns.map((g) => g.id)
    const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) groupIds.forEach((id) => next.delete(id))
      else groupIds.forEach((id) => next.add(id))
      return next
    })
  }

  function toggleDisputedGrn(id: string) {
    setIncludedDisputedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handlePreviewEmail() {
    form.handleSubmit((values) => {
      const vendor = eligibleQuery.data!.vendor
      const selectedReconciled = allReconciled.filter((g) => effectiveSelectedIds.has(g.id))
      const selectedDisputed = allDisputed.filter((g) => includedDisputedIds.has(g.id))
      const allSelected = [...selectedReconciled, ...selectedDisputed]

      // Use allocation amounts if available
      const allocationAmountMap = new Map<string, number>()
      if (allocation) {
        allocation.fullyPaidGrns.forEach((g) => allocationAmountMap.set(g.grnId, g.allocatedAmount))
        if (allocation.partialGrn) {
          allocationAmountMap.set(allocation.partialGrn.grnId, allocation.partialGrn.allocatedAmount)
        }
      }

      const grns = allSelected.map((g) => ({
        grnNumber: g.grnNumber,
        invoiceNumber: g.invoice.invoiceNumber,
        amount: allocationAmountMap.get(g.id) ?? g.remainingAmount,
      }))

      setEmailHtml(
        buildEmailHtml({
          vendorName: vendor.name,
          amount: effectivePaymentAmount,
          date: values.paymentDate,
          mode: values.paymentMode,
          transactionRef: values.transactionRef || null,
          grns,
        }),
      )
      if (!emailBody) {
        setEmailBody(
          buildDefaultEmailBody({
            vendorName: vendor.name,
            amount: effectivePaymentAmount,
            date: values.paymentDate,
            mode: values.paymentMode,
            transactionRef: values.transactionRef || null,
            grns,
          }),
        )
      }
      setEmailDialogOpen(true)
    })()
  }

  function handleOpenConfirm() {
    form.handleSubmit(() => {
      setConfirmDialogOpen(true)
    })()
  }

  function handleConfirmPayment() {
    const values = form.getValues()
    const disputedIds = [...includedDisputedIds]
    const reconciledGrnIds = allReconciled.filter((g) => effectiveSelectedIds.has(g.id)).map((g) => g.id)

    // Build grnAllocations from current allocation result
    let grnAllocations:
      | Array<{ grnId: string; amountPaid: number; isPartial: boolean }>
      | undefined

    if (allocation) {
      grnAllocations = [
        ...allocation.fullyPaidGrns.map((g) => ({
          grnId: g.grnId,
          amountPaid: g.allocatedAmount,
          isPartial: false,
        })),
        ...(allocation.partialGrn
          ? [
              {
                grnId: allocation.partialGrn.grnId,
                amountPaid: allocation.partialGrn.allocatedAmount,
                isPartial: true,
              },
            ]
          : []),
      ]
    }

    createPaymentMutation.mutate({
      vendorId: loadedVendorId!,
      grnIds: reconciledGrnIds,
      ...(disputedIds.length > 0 ? { includeDisputedIds: disputedIds } : {}),
      paymentDate: values.paymentDate,
      paymentMode: values.paymentMode,
      ...(values.transactionRef ? { transactionRef: values.transactionRef } : {}),
      ...(values.remarks ? { remarks: values.remarks } : {}),
      ...(emailBody ? { emailBody } : {}),
      sendEmail,
      ...(grnAllocations ? { grnAllocations } : {}),
    })
    setConfirmDialogOpen(false)
  }

  function handleMakeAnother() {
    setSuccessPayment(null)
    setLoadedVendorId(null)
    setSelectedIds(new Set())
    setIncludedDisputedIds(new Set())
    setEmailBody('')
    setAllocation(null)
    setPaymentAmountInput('')
    setSendEmail(true)
    form.reset({
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      paymentMode: 'neft',
      transactionRef: '',
      remarks: '',
    })
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  const vendor = eligibleQuery.data?.vendor

  return (
    <div className="space-y-10 pb-56">
      <h1 className="text-2xl font-bold tracking-tight">Payments</h1>

      {/* ── New Payment ── */}
      <section className="space-y-5">
        <h2 className="text-lg font-semibold">New Payment</h2>

        {/* Vendor selector + load button */}
        <div className="flex flex-wrap items-end gap-3">
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
                  if (loadedVendorId !== id) {
                    setLoadedVendorId(null)
                    setSelectedIds(new Set())
                    setIncludedDisputedIds(new Set())
                    setSuccessPayment(null)
                    setEmailBody('')
                    setAllocation(null)
                    setPaymentAmountInput('')
                  }
                }}
              />
            )}
          </div>
          <Button
            onClick={handleLoad}
            disabled={!selectedVendorId || eligibleQuery.isFetching}
          >
            {eligibleQuery.isFetching ? 'Loading…' : 'Load Outstanding GRNs'}
          </Button>
        </div>

        {/* Empty state */}
        {!loadedVendorId && (
          <div className="rounded-md border px-6 py-16 text-center text-muted-foreground text-sm">
            Select a vendor and click Load Outstanding GRNs.
          </div>
        )}

        {/* Error state */}
        {loadedVendorId && eligibleQuery.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load GRNs. Please try again.
          </div>
        )}

        {/* Loading skeleton */}
        {loadedVendorId && eligibleQuery.isLoading && (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-48 animate-pulse rounded-md bg-muted" />
          </div>
        )}

        {/* Success state */}
        {loadedVendorId && eligibleQuery.isSuccess && successPayment && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={24} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900">
                  Payment of {inr(successPayment.amount)} confirmed.
                </p>
                {successPayment.emailSent && successPayment.email && (
                  <p className="text-sm text-green-700 mt-1">
                    Email sent to {successPayment.email}.
                  </p>
                )}
                {!successPayment.emailSent && (
                  <p className="text-sm text-muted-foreground mt-1">No email was sent.</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaymentSheetId(successPayment.id)}
              >
                View Payment Receipt
              </Button>
              <Button variant="outline" size="sm" onClick={handleMakeAnother}>
                Make Another Payment
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/admin/ledger?vendorId=${loadedVendorId}`)}
                className="gap-1"
              >
                Go to Ledger <ArrowRight size={13} />
              </Button>
            </div>
          </div>
        )}

        {/* No GRNs */}
        {loadedVendorId &&
          eligibleQuery.isSuccess &&
          !successPayment &&
          !hasGrns && (
            <div className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
              No eligible GRNs found for this vendor.
            </div>
          )}

        {/* GRN selection */}
        {loadedVendorId && eligibleQuery.isSuccess && !successPayment && hasGrns && (
          <div className="space-y-4">
            {/* Summary row + controls */}
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{allReconciled.length}</span>{' '}
                GRN{allReconciled.length !== 1 ? 's' : ''} totalling{' '}
                <span className="font-medium text-foreground">
                  {inr(eligibleQuery.data.totalOutstanding)}
                </span>{' '}
                available
              </p>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearAll}>
                  Clear All
                </Button>
              </div>
            </div>

            {/* Month groups table */}
            {sortedGroups.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                {sortedGroups.map((group) => {
                  const groupIds = group.grns.map((g) => g.id)
                  const selectedInGroup = groupIds.filter((id) => selectedIds.has(id))
                  const allInGroup =
                    groupIds.length > 0 && selectedInGroup.length === groupIds.length
                  const someInGroup =
                    selectedInGroup.length > 0 && !allInGroup

                  return (
                    <div
                      key={`${group.year}-${group.month}`}
                      className="border-b last:border-0"
                    >
                      {/* Month header */}
                      <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (el) el.indeterminate = someInGroup
                          }}
                          checked={allInGroup}
                          onChange={() => toggleMonth(group)}
                          className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                        />
                        <span className="font-semibold text-sm uppercase tracking-wide flex-1">
                          {group.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {inr(group.groupTotal)} available
                        </span>
                      </div>

                      {/* GRN rows */}
                      {group.grns.map((grn) => {
                        const isExcluded = allocation?.excludedGrns.some((g) => g.grnId === grn.id) ?? false
                        const isPartialInAlloc = allocation?.partialGrn?.grnId === grn.id
                        const allocAmount = isPartialInAlloc
                          ? allocation!.partialGrn!.allocatedAmount
                          : allocation?.fullyPaidGrns.find((g) => g.grnId === grn.id)?.allocatedAmount

                        return (
                          <div
                            key={grn.id}
                            className={cn(
                              'flex items-center gap-3 px-4 py-2.5 border-t transition-colors',
                              isExcluded
                                ? 'bg-muted/40 opacity-60 hover:bg-muted/50'
                                : 'hover:bg-muted/20',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(grn.id)}
                              onChange={() => toggleGrn(grn.id)}
                              className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                            />
                            <span
                              className={cn(
                                'font-mono text-xs w-28 shrink-0',
                                isExcluded && 'line-through text-muted-foreground',
                              )}
                            >
                              {grn.grnNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => setInvoiceSheetId(grn.invoiceId)}
                              className="flex items-center gap-1 font-mono text-xs text-primary hover:underline w-28 shrink-0"
                            >
                              {grn.invoice.invoiceNumber}
                              <ExternalLink size={10} className="shrink-0" />
                            </button>
                            <span className="text-xs text-muted-foreground w-24 shrink-0">
                              {fmtDate(grn.grnDate)}
                            </span>
                            <span className="tabular-nums text-sm font-medium flex-1">
                              {allocAmount !== undefined ? (
                                <>
                                  {isPartialInAlloc ? (
                                    <span className="text-amber-700">
                                      {inr(allocAmount)}{' '}
                                      <span className="text-xs font-normal text-muted-foreground">
                                        of {inr(grn.remainingAmount)}
                                      </span>
                                    </span>
                                  ) : (
                                    inr(allocAmount)
                                  )}
                                </>
                              ) : (
                                inr(grn.remainingAmount)
                              )}
                            </span>
                            {grn.isPartiallyPaid ? (
                              <Badge
                                variant="outline"
                                className="text-amber-700 border-amber-400 text-xs shrink-0"
                                title={`₹${grn.paidAmount.toLocaleString('en-IN')} paid, ₹${grn.remainingAmount.toLocaleString('en-IN')} remaining of ₹${grn.grnAmount.toLocaleString('en-IN')} total`}
                              >
                                Partial — {inr(grn.remainingAmount)} remaining
                              </Badge>
                            ) : isExcluded ? (
                              <Badge variant="secondary" className="text-xs shrink-0 text-muted-foreground">
                                Excluded
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs shrink-0">
                                Reconciled
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Disputed GRNs section */}
            {sortedDisputedGroups.length > 0 && (
              <div className="rounded-md border">
                <button
                  type="button"
                  onClick={() => setDisputedOpen((o) => !o)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors rounded-md"
                >
                  {disputedOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <span>
                    Disputed GRNs (excluded by default)
                  </span>
                  <span className="text-muted-foreground font-normal ml-1">
                    — {inr(eligibleQuery.data.totalDisputedAmount ?? 0)} total
                  </span>
                </button>

                {disputedOpen && (
                  <div className="border-t">
                    {includedDisputedIds.size > 0 && (
                      <div className="flex items-start gap-2 mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span>
                          You are including {includedDisputedIds.size} disputed GRN
                          {includedDisputedIds.size !== 1 ? 's' : ''} in this payment.
                        </span>
                      </div>
                    )}

                    {sortedDisputedGroups.map((group) => (
                      <div
                        key={`disputed-${group.year}-${group.month}`}
                        className="border-b last:border-0"
                      >
                        <div className="px-4 py-2 bg-muted/20 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label} — {inr(group.groupTotal)}
                        </div>
                        {group.grns.map((grn) => (
                          <div
                            key={grn.id}
                            className="flex items-center gap-3 px-4 py-2.5 border-t bg-amber-50/40 hover:bg-amber-50/80 transition-colors"
                          >
                            <span className="font-mono text-xs w-28 shrink-0">
                              {grn.grnNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => setInvoiceSheetId(grn.invoiceId)}
                              className="flex items-center gap-1 font-mono text-xs text-primary hover:underline w-28 shrink-0"
                            >
                              {grn.invoice.invoiceNumber}
                              <ExternalLink size={10} className="shrink-0" />
                            </button>
                            <span className="text-xs text-muted-foreground w-24 shrink-0">
                              {fmtDate(grn.grnDate)}
                            </span>
                            <span className="tabular-nums text-sm font-medium flex-1">
                              {inr(grn.remainingAmount)}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-amber-700 border-amber-400 text-xs shrink-0"
                            >
                              Disputed
                            </Badge>
                            <button
                              type="button"
                              onClick={() => toggleDisputedGrn(grn.id)}
                              className={cn(
                                'text-xs rounded px-2 py-1 border transition-colors shrink-0',
                                includedDisputedIds.has(grn.id)
                                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                                  : 'bg-background text-muted-foreground border-input hover:bg-muted',
                              )}
                            >
                              {includedDisputedIds.has(grn.id) ? 'Included ✓' : 'Include?'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Payment History ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Payment History</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 min-w-[200px]">
            <Label>Vendor</Label>
            <select
              value={histVendorId}
              onChange={(e) => {
                setHistVendorId(e.target.value)
                setHistPage(1)
              }}
              className={selectCls}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Month</Label>
            <select
              value={histMonth}
              onChange={(e) => {
                setHistMonth(e.target.value)
                setHistPage(1)
              }}
              className={cn(selectCls, 'w-36')}
            >
              <option value="">All months</option>
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <select
              value={histYear}
              onChange={(e) => {
                setHistYear(e.target.value)
                setHistPage(1)
              }}
              className={cn(selectCls, 'w-28')}
            >
              <option value="">All years</option>
              {YEARS.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                {['Date', 'Vendor', 'Amount', 'Mode', 'Reference', 'GRNs', 'Email', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyQuery.isLoading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Loading payments…
                  </td>
                </tr>
              ) : historyQuery.isError ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-destructive"
                  >
                    Failed to load payments.
                  </td>
                </tr>
              ) : (historyQuery.data?.data ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No payments found.
                  </td>
                </tr>
              ) : (
                (historyQuery.data?.data ?? []).map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      {fmtDate(payment.paymentDate)}
                    </td>
                    <td className="px-4 py-3 font-medium">{payment.vendor.name}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">
                      {inr(Number(payment.totalAmount))}
                    </td>
                    <td className="px-4 py-3">{modeLabel(payment.paymentMode)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {payment.transactionRef ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {payment._count.paymentGrns}
                    </td>
                    <td className="px-4 py-3">
                      {payment.emailSent ? (
                        <span className="flex items-center gap-1 text-xs text-green-700">
                          <MailCheck size={13} />
                          Sent ✓
                        </span>
                      ) : payment.vendor.email ? (
                        <button
                          type="button"
                          disabled={resendingId === payment.id || resendEmailMutation.isPending}
                          onClick={() => {
                            setResendingId(payment.id)
                            resendEmailMutation.mutate(payment.id)
                          }}
                          className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw size={12} className={resendingId === payment.id ? 'animate-spin' : ''} />
                          {resendingId === payment.id ? 'Sending…' : 'Send Now'}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not sent</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPaymentSheetId(payment.id)}
                      >
                        <Eye size={14} />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {historyQuery.data?.pagination &&
          historyQuery.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {historyQuery.data.pagination.total} payment
                {historyQuery.data.pagination.total !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                  disabled={histPage === 1}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground">
                  {histPage} / {historyQuery.data.pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setHistPage((p) =>
                      Math.min(historyQuery.data!.pagination.totalPages, p + 1),
                    )
                  }
                  disabled={histPage === historyQuery.data.pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
      </section>

      {/* ── Sticky payment summary panel ── */}
      {loadedVendorId && eligibleQuery.isSuccess && !successPayment && hasGrns && (
        <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur-sm border-t shadow-lg px-6 py-4 space-y-3 -mx-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Selected:{' '}
              <span className="font-medium text-foreground">
                {selectedIds.size} GRN{selectedIds.size !== 1 ? 's' : ''}
              </span>
              {selectedInvoiceCount > 0 && (
                <>
                  {' '}from{' '}
                  <span className="font-medium text-foreground">
                    {selectedInvoiceCount} invoice{selectedInvoiceCount !== 1 ? 's' : ''}
                  </span>
                </>
              )}
              {selectedMonthCount > 0 && (
                <>
                  {' '}across{' '}
                  <span className="font-medium text-foreground">
                    {selectedMonthCount} month{selectedMonthCount !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </p>
            <p className="text-lg font-bold tabular-nums shrink-0">{inr(selectedTotal)}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Payment Date</Label>
              <Input
                type="date"
                {...form.register('paymentDate')}
                className={cn(
                  'h-9 text-sm',
                  form.formState.errors.paymentDate && 'border-destructive',
                )}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payment Mode</Label>
              <select
                {...form.register('paymentMode')}
                className={cn(selectCls, 'h-9 text-sm')}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transaction Ref</Label>
              <Input
                {...form.register('transactionRef')}
                placeholder="UTR / cheque no."
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Remarks</Label>
              <Input
                {...form.register('remarks')}
                placeholder="Optional"
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Payment amount + allocation */}
          {selectedIds.size > 0 && (
            <div className="space-y-2">
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Payment Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentAmountInput}
                    onChange={(e) => setPaymentAmountInput(e.target.value)}
                    placeholder={selectedTotal.toFixed(2)}
                    className={cn(
                      'h-9 text-sm w-48 tabular-nums',
                      amountError && 'border-destructive',
                    )}
                  />
                </div>
                {allocationLoading && (
                  <p className="text-xs text-muted-foreground pb-2">Calculating…</p>
                )}
              </div>
              {amountError && (
                <p className="text-xs text-destructive">{amountError}</p>
              )}
              {allocation && !amountError && (
                <AllocationPreview allocation={allocation} />
              )}
            </div>
          )}

          {/* Email toggle */}
          <div className="flex items-center gap-2">
            <input
              id="sendEmailToggle"
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 cursor-pointer"
            />
            <label htmlFor="sendEmailToggle" className="text-sm cursor-pointer select-none">
              Send payment confirmation email to vendor
            </label>
          </div>

          <div className="flex justify-end gap-3">
            {sendEmail && (
              <Button
                variant="outline"
                onClick={handlePreviewEmail}
                disabled={selectedIds.size === 0}
              >
                Preview Email
              </Button>
            )}
            <Button onClick={handleOpenConfirm} disabled={!canConfirm}>
              Confirm Payment
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs & Sheets ── */}
      <EmailPreviewDialog
        open={emailDialogOpen}
        emailHtml={emailHtml}
        emailBody={emailBody}
        onEmailBodyChange={setEmailBody}
        onClose={() => setEmailDialogOpen(false)}
      />

      <ConfirmPaymentDialog
        open={confirmDialogOpen}
        vendorName={vendor?.name ?? selectedVendorName}
        vendorEmail={vendor?.email ?? null}
        amount={effectivePaymentAmount}
        grnCount={selectedCount}
        sendEmail={sendEmail}
        onClose={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirmPayment}
        isPending={createPaymentMutation.isPending}
      />

      <InvoiceDetailSheet
        invoiceId={invoiceSheetId}
        onClose={() => setInvoiceSheetId(null)}
      />

      <PaymentDetailSheet
        paymentId={paymentSheetId}
        onClose={() => setPaymentSheetId(null)}
      />
    </div>
  )
}
