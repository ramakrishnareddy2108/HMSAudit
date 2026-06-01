import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Eye, MailCheck, MailX, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  name: string
  email: string | null
  contactName: string | null
  isActive: boolean
}

interface GrnEntry {
  id: string
  grnNumber: string
  grnAmount: string
  grnDate: string | null
  status: string
  invoiceId: string
  invoice: { id: string; invoiceNumber: string; invoiceAmount: string }
}

type GrnRow = GrnEntry & { isDisputed: boolean }

interface EligibleGrnsResponse {
  grns: GrnEntry[]
  disputedGrns: GrnEntry[]
  totalAmount: number
  vendor: { id: string; name: string; email: string | null; contactName: string | null }
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
  vendor: { id: string; name: string; email: string | null; contactName: string | null; phone: string | null }
  paymentGrns: Array<{
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

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)

// ── Helpers ────────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function modeLabel(mode: string): string {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode.toUpperCase()
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

// ── Select style shared class ──────────────────────────────────────────────────

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

// ── Payment form schema ────────────────────────────────────────────────────────

const paymentSchema = z.object({
  paymentDate: z.string().min(1, 'Date is required'),
  paymentMode: z.enum(['neft', 'rtgs', 'cheque', 'cash']),
  transactionRef: z.string().optional(),
  remarks: z.string().optional(),
})
type PaymentFormValues = z.infer<typeof paymentSchema>

// ── Email Preview Dialog ───────────────────────────────────────────────────────

interface EmailPreviewDialogProps {
  open: boolean
  emailHtml: string
  emailBody: string
  onEmailBodyChange: (v: string) => void
  onConfirm: () => void
  isPending: boolean
  onClose: () => void
}

function EmailPreviewDialog({
  open,
  emailHtml,
  emailBody,
  onEmailBodyChange,
  onConfirm,
  isPending,
  onClose,
}: EmailPreviewDialogProps) {
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
            <Label>Custom Message Body</Label>
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Sending…' : 'Confirm & Send Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Payment Detail Dialog ──────────────────────────────────────────────────────

interface PaymentDetailDialogProps {
  paymentId: string | null
  onClose: () => void
}

function PaymentDetailDialog({ paymentId, onClose }: PaymentDetailDialogProps) {
  const queryClient = useQueryClient()
  const [resendBody, setResendBody] = useState('')
  const [showResend, setShowResend] = useState(false)

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
            amount: Number(pg.grn.grnAmount),
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
    <Dialog open={Boolean(paymentId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Details</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
        ) : !data ? (
          <div className="py-12 text-center text-destructive text-sm">Failed to load payment.</div>
        ) : (
          <div className="space-y-5">
            {/* Info grid */}
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
                <p>{format(new Date(data.paymentDate), 'dd MMM yyyy')}</p>
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
                <div>
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
                        Sent {data.emailSentAt ? format(new Date(data.emailSentAt), 'dd MMM yyyy HH:mm') : ''}
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

            {/* GRN table */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                GRN Breakdown
              </p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {['GRN No.', 'Invoice No.', 'Amount', 'Invoice Status'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.paymentGrns.map((pg, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-mono text-xs">{pg.grn.grnNumber}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{pg.grn.invoice.invoiceNumber}</td>
                        <td className="px-4 py-2.5 tabular-nums">{inr(Number(pg.grn.grnAmount))}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="default" className="capitalize">
                            {pg.grn.invoice.status.replace('_', ' ')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Resend email */}
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const queryClient = useQueryClient()

  // ── New payment: filter state ──
  const [filterVendorId, setFilterVendorId] = useState('')
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [loadedFilter, setLoadedFilter] = useState<{
    vendorId: string
    month: number
    year: number
  } | null>(null)

  // ── GRN table selection ──
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // ── Email preview ──
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailBody, setEmailBody] = useState('')
  const [emailHtml, setEmailHtml] = useState('')

  // ── Payment detail ──
  const [viewPaymentId, setViewPaymentId] = useState<string | null>(null)

  // ── History filters ──
  const [histPage, setHistPage] = useState(1)
  const [histVendorId, setHistVendorId] = useState('')
  const [histMonth, setHistMonth] = useState<string>('')
  const [histYear, setHistYear] = useState<string>(String(new Date().getFullYear()))

  // ── Queries ──

  const { data: vendorsData } = useQuery<{ data: Vendor[] }>({
    queryKey: ['vendors-all'],
    queryFn: () => api.get('/vendors', { params: { limit: 500 } }).then((r) => r.data),
  })
  const vendors = vendorsData?.data ?? []

  const eligibleQuery = useQuery<EligibleGrnsResponse>({
    queryKey: ['eligible-grns', loadedFilter],
    queryFn: () =>
      api
        .get('/payments/eligible-grns', {
          params: {
            vendorId: loadedFilter!.vendorId,
            month: loadedFilter!.month,
            year: loadedFilter!.year,
          },
        })
        .then((r) => r.data as EligibleGrnsResponse),
    enabled: Boolean(loadedFilter),
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

  // ── Payment form ──

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      paymentMode: 'neft',
      transactionRef: '',
      remarks: '',
    },
  })

  // ── Derived: combined GRN rows ──

  const tableRows = useMemo<GrnRow[]>(() => {
    if (!eligibleQuery.data) return []
    return [
      ...eligibleQuery.data.grns.map((g) => ({ ...g, isDisputed: false })),
      ...eligibleQuery.data.disputedGrns.map((g) => ({ ...g, isDisputed: true })),
    ]
  }, [eligibleQuery.data])

  // Auto-select all reconciled rows when data loads
  useEffect(() => {
    if (!eligibleQuery.data) return
    const initial: RowSelectionState = {}
    eligibleQuery.data.grns.forEach((_, i) => {
      initial[i] = true
    })
    setRowSelection(initial)
  }, [eligibleQuery.data])

  const selectedGrns = useMemo<GrnRow[]>(() => {
    return Object.entries(rowSelection)
      .filter(([, sel]) => sel)
      .map(([idx]) => tableRows[parseInt(idx)])
      .filter(Boolean)
  }, [rowSelection, tableRows])

  const selectedTotal = useMemo(
    () => selectedGrns.reduce((s, g) => s + Number(g.grnAmount), 0),
    [selectedGrns],
  )

  // ── Mutations ──

  const createPaymentMutation = useMutation({
    mutationFn: (body: {
      vendorId: string
      grnIds: string[]
      paymentDate: string
      paymentMode: string
      transactionRef?: string
      remarks?: string
      emailBody: string
    }) => api.post('/payments', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      toast.success('Payment recorded and email sent')
      setEmailDialogOpen(false)
      setLoadedFilter(null)
      setRowSelection({})
      form.reset({
        paymentDate: format(new Date(), 'yyyy-MM-dd'),
        paymentMode: 'neft',
        transactionRef: '',
        remarks: '',
      })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to record payment'
      toast.error(msg)
    },
  })

  // ── Handlers ──

  function handleLoadGrns() {
    if (!filterVendorId) {
      toast.error('Select a vendor first')
      return
    }
    setLoadedFilter({ vendorId: filterVendorId, month: filterMonth, year: filterYear })
    setRowSelection({})
  }

  function handlePreviewEmail() {
    if (selectedGrns.length === 0) {
      toast.error('Select at least one GRN')
      return
    }
    form.handleSubmit((values) => {
      const vendor = eligibleQuery.data!.vendor
      const grns = selectedGrns.map((g) => ({
        grnNumber: g.grnNumber,
        invoiceNumber: g.invoice.invoiceNumber,
        amount: Number(g.grnAmount),
      }))
      setEmailHtml(
        buildEmailHtml({
          vendorName: vendor.name,
          amount: selectedTotal,
          date: values.paymentDate,
          mode: values.paymentMode,
          transactionRef: values.transactionRef || null,
          grns,
        }),
      )
      setEmailBody(
        buildDefaultEmailBody({
          vendorName: vendor.name,
          amount: selectedTotal,
          date: values.paymentDate,
          mode: values.paymentMode,
          transactionRef: values.transactionRef || null,
          grns,
        }),
      )
      setEmailDialogOpen(true)
    })()
  }

  function handleConfirmPayment() {
    const values = form.getValues()
    createPaymentMutation.mutate({
      vendorId: loadedFilter!.vendorId,
      grnIds: selectedGrns.map((g) => g.id),
      paymentDate: values.paymentDate,
      paymentMode: values.paymentMode,
      transactionRef: values.transactionRef || undefined,
      remarks: values.remarks || undefined,
      emailBody,
    })
  }

  // ── GRN table columns ──

  const grnColumns: ColumnDef<GrnRow>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          ref={(el) => {
            if (el) {
              el.indeterminate =
                table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
            }
          }}
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          className="h-4 w-4 rounded border-gray-300 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          className="h-4 w-4 rounded border-gray-300 cursor-pointer"
        />
      ),
    },
    {
      accessorKey: 'grnNumber',
      header: 'GRN No.',
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{getValue() as string}</span>
      ),
    },
    {
      id: 'invoiceNumber',
      header: 'Invoice No.',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.invoice.invoiceNumber}</span>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: ({ row }) => (
        <span className="tabular-nums">{inr(Number(row.original.grnAmount))}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isDisputed ? (
          <Badge variant="outline" className="text-amber-700 border-amber-400">
            Disputed
          </Badge>
        ) : (
          <Badge variant="secondary">Reconciled</Badge>
        ),
    },
  ]

  const grnTable = useReactTable({
    data: tableRows,
    columns: grnColumns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  })

  // ── History table columns ──

  const histColumns: ColumnDef<Payment>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => format(new Date(row.original.paymentDate), 'dd MMM yyyy'),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      cell: ({ row }) => <span className="font-medium">{row.original.vendor.name}</span>,
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: ({ row }) => (
        <span className="tabular-nums font-semibold">{inr(Number(row.original.totalAmount))}</span>
      ),
    },
    {
      id: 'mode',
      header: 'Mode',
      cell: ({ row }) => modeLabel(row.original.paymentMode),
    },
    {
      id: 'ref',
      header: 'Reference',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.transactionRef ?? '—'}</span>
      ),
    },
    {
      id: 'grnCount',
      header: 'GRNs',
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{row.original._count.paymentGrns}</span>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      cell: ({ row }) =>
        row.original.emailSent ? (
          <span className="flex items-center gap-1 text-green-700 text-xs">
            <MailCheck size={13} /> Sent
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <MailX size={13} /> Not sent
          </span>
        ),
    },
    {
      id: 'view',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setViewPaymentId(row.original.id)}
        >
          <Eye size={14} />
        </Button>
      ),
    },
  ]

  const histTable = useReactTable({
    data: historyQuery.data?.data ?? [],
    columns: histColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const histPagination = historyQuery.data?.pagination

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold tracking-tight">Payments</h1>

      {/* ── Section 1: New Payment ── */}
      <section className="space-y-5">
        <h2 className="text-lg font-semibold">New Payment</h2>

        {/* Filter row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 min-w-[220px]">
            <Label>Vendor</Label>
            <select
              value={filterVendorId}
              onChange={(e) => {
                setFilterVendorId(e.target.value)
                setLoadedFilter(null)
                setRowSelection({})
              }}
              className={selectCls}
            >
              <option value="">Select vendor…</option>
              {vendors.filter((v) => v.isActive).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Month</Label>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
              className={cn(selectCls, 'w-36')}
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
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

          <Button onClick={handleLoadGrns} disabled={eligibleQuery.isFetching}>
            {eligibleQuery.isFetching ? 'Loading…' : 'Load GRNs'}
          </Button>
        </div>

        {/* GRN table + Payment form */}
        {loadedFilter && (
          <>
            {eligibleQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Failed to load GRNs. Please try again.
              </div>
            ) : eligibleQuery.isSuccess &&
              tableRows.length === 0 ? (
              <div className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
                No eligible GRNs found for this vendor and period.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
                {/* GRN selection table */}
                <div className="space-y-3">
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 border-b">
                        {grnTable.getHeaderGroups().map((hg) => (
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
                        {eligibleQuery.isFetching ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                              Loading GRNs…
                            </td>
                          </tr>
                        ) : (
                          grnTable.getRowModel().rows.map((row) => (
                            <tr
                              key={row.id}
                              className={cn(
                                'border-b last:border-0 transition-colors',
                                row.original.isDisputed
                                  ? 'bg-amber-50/60 hover:bg-amber-50'
                                  : 'hover:bg-muted/30',
                              )}
                            >
                              {row.getVisibleCells().map((cell) => (
                                <td key={cell.id} className="px-4 py-2.5">
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Disputed notice */}
                  {eligibleQuery.data && eligibleQuery.data.disputedGrns.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        {eligibleQuery.data.disputedGrns.length} disputed GRN
                        {eligibleQuery.data.disputedGrns.length !== 1 ? 's' : ''} shown at the
                        bottom — unchecked by default.
                      </span>
                    </div>
                  )}

                  {/* Running total */}
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground">
                      Selected: {selectedGrns.length} GRN{selectedGrns.length !== 1 ? 's' : ''}
                    </span>
                    <span className="font-semibold tabular-nums">{inr(selectedTotal)}</span>
                  </div>
                </div>

                {/* Payment details form */}
                <div className="rounded-md border p-5 space-y-4">
                  <p className="text-sm font-semibold">Payment Details</p>

                  <div className="space-y-1.5">
                    <Label htmlFor="paymentDate">Payment Date</Label>
                    <Input
                      id="paymentDate"
                      type="date"
                      {...form.register('paymentDate')}
                      className={cn(form.formState.errors.paymentDate && 'border-destructive')}
                    />
                    {form.formState.errors.paymentDate && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.paymentDate.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="paymentMode">Payment Mode</Label>
                    <select
                      id="paymentMode"
                      {...form.register('paymentMode')}
                      className={cn(
                        selectCls,
                        form.formState.errors.paymentMode && 'border-destructive',
                      )}
                    >
                      {PAYMENT_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="transactionRef">Transaction Ref</Label>
                    <Input
                      id="transactionRef"
                      {...form.register('transactionRef')}
                      placeholder="UTR / cheque number"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="remarks">Remarks</Label>
                    <Textarea
                      id="remarks"
                      {...form.register('remarks')}
                      placeholder="Optional notes"
                      rows={3}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={handlePreviewEmail}
                    disabled={selectedGrns.length === 0}
                  >
                    Preview Email
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Section 2: Payment History ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Payment History</h2>

        {/* History filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 min-w-[200px]">
            <Label>Vendor</Label>
            <select
              value={histVendorId}
              onChange={(e) => { setHistVendorId(e.target.value); setHistPage(1) }}
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
              onChange={(e) => { setHistMonth(e.target.value); setHistPage(1) }}
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
              onChange={(e) => { setHistYear(e.target.value); setHistPage(1) }}
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

        {/* History table */}
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              {histTable.getHeaderGroups().map((hg) => (
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
              {historyQuery.isLoading ? (
                <tr>
                  <td colSpan={histColumns.length} className="px-4 py-10 text-center text-muted-foreground">
                    Loading payments…
                  </td>
                </tr>
              ) : historyQuery.isError ? (
                <tr>
                  <td colSpan={histColumns.length} className="px-4 py-10 text-center text-destructive">
                    Failed to load payments.
                  </td>
                </tr>
              ) : histTable.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={histColumns.length} className="px-4 py-10 text-center text-muted-foreground">
                    No payments found.
                  </td>
                </tr>
              ) : (
                histTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
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

        {/* Pagination */}
        {histPagination && histPagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {histPagination.total} payment{histPagination.total !== 1 ? 's' : ''}
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
                {histPage} / {histPagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistPage((p) => Math.min(histPagination.totalPages, p + 1))}
                disabled={histPage === histPagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Email Preview Dialog ── */}
      <EmailPreviewDialog
        open={emailDialogOpen}
        emailHtml={emailHtml}
        emailBody={emailBody}
        onEmailBodyChange={setEmailBody}
        onConfirm={handleConfirmPayment}
        isPending={createPaymentMutation.isPending}
        onClose={() => setEmailDialogOpen(false)}
      />

      {/* ── Payment Detail Dialog ── */}
      <PaymentDetailDialog
        paymentId={viewPaymentId}
        onClose={() => setViewPaymentId(null)}
      />
    </div>
  )
}
