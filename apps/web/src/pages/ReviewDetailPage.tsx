import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Package,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type InvoiceStatus } from '@/components/invoices/InvoiceCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GrnEntry {
  id: string
  grnNumber: string
  grnAmount: string
  grnDate: string | null
  status: string
}

interface GrnSnapshotItem {
  grnNumber: string
  grnAmount: string
  grnDate: string | null
}

interface InvoiceChangeItem {
  field: string
  oldValue: string
  newValue: string
}

interface GrnChangeItem {
  grnNumber: string
  changeType: 'added' | 'removed' | 'updated'
  field?: string
  oldValue?: string
  newValue?: string
}

interface InvoiceVersion {
  id: string
  versionNo: number
  invoiceAmount: string
  statusAtChange: string
  changeReason: string | null
  changeSummary: { invoiceChanges: InvoiceChangeItem[]; grnChanges: GrnChangeItem[] } | null
  grnSnapshot: GrnSnapshotItem[] | null
  changedByUser: { id: string; name: string }
  createdAt: string
}

interface ReviewInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: string
  billType: 'grn_bill' | 'miscellaneous'
  miscCategory: string | null
  miscDescription: string | null
  status: InvoiceStatus
  isPriceRevised: boolean
  currentVersionNo: number
  fileUrl: string | null
  fileType: 'image' | 'pdf' | null
  reviewerNote: string | null
  createdAt: string
  vendor: { id: string; name: string; phone: string | null; email: string | null }
  department: { id: string; name: string } | null
  uploader: { id: string; name: string; email: string }
  grnEntries: GrnEntry[]
  versions: InvoiceVersion[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIndianCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return '₹' + new Intl.NumberFormat('en-IN').format(num)
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? '—'}</p>
    </div>
  )
}

// ── Approve Dialog ────────────────────────────────────────────────────────────

interface ApproveDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (note: string) => void
  isPending: boolean
}

function ApproveDialog({ open, onClose, onConfirm, isPending }: ApproveDialogProps) {
  const [note, setNote] = useState('')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-green-600" />
            Approve Invoice?
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            This will mark the invoice as <strong>Approved</strong>. You can optionally add a note.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="approve-note" className="text-xs">Note (optional)</Label>
            <Input
              id="approve-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Verified against PO #4421"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onConfirm(note)}
            disabled={isPending}
          >
            {isPending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Send-back Dialog ──────────────────────────────────────────────────────────

interface SendBackDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (note: string) => void
  isPending: boolean
}

function SendBackDialog({ open, onClose, onConfirm, isPending }: SendBackDialogProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  function handleConfirm() {
    if (!note.trim()) { setError('Please explain why you are sending this back.'); return }
    setError('')
    onConfirm(note.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle size={18} className="text-destructive" />
            Send Back to Uploader?
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            The invoice will be sent back with your note. The uploader will need to revise and resubmit.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="sendback-note" className="text-xs">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sendback-note"
              value={note}
              onChange={(e) => { setNote(e.target.value); setError('') }}
              placeholder="e.g. Invoice amount doesn't match PO. Please correct."
              className={cn(error && 'border-destructive')}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Sending back…' : 'Send Back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Version History ───────────────────────────────────────────────────────────

function VersionChangeList({ version }: { version: InvoiceVersion }) {
  if (version.versionNo === 1) {
    const grns = version.grnSnapshot ?? []
    return (
      <div className="mt-1.5 space-y-0.5">
        <p className="text-xs text-muted-foreground">📄 Initial upload</p>
        {grns.map((g) => (
          <p key={g.grnNumber} className="text-xs text-muted-foreground">
            ➕ GRN {g.grnNumber} — {formatIndianCurrency(g.grnAmount)}
            {g.grnDate ? ` · ${format(parseISO(g.grnDate), 'd MMM yyyy')}` : ''}
          </p>
        ))}
      </div>
    )
  }

  if (!version.changeSummary) {
    return (
      <p className="text-xs text-muted-foreground italic mt-1">
        Version created — details not available
      </p>
    )
  }

  const { invoiceChanges, grnChanges } = version.changeSummary
  if (invoiceChanges.length === 0 && grnChanges.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic mt-1">No field changes detected</p>
    )
  }

  return (
    <div className="mt-1.5 space-y-0.5">
      {invoiceChanges.map((c, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {c.field === 'invoiceAmount'
            ? `💰 Invoice amount changed from ${c.oldValue} to ${c.newValue}`
            : c.field === 'invoiceDate'
              ? `📅 Invoice date changed from ${c.oldValue} to ${c.newValue}`
              : c.field === 'fileUrl'
                ? '🖼️ Invoice image updated'
                : `${c.field} changed from ${c.oldValue} to ${c.newValue}`}
        </p>
      ))}
      {grnChanges.map((c, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {c.changeType === 'added'
            ? `➕ GRN ${c.grnNumber} added — ${c.newValue}`
            : c.changeType === 'removed'
              ? `➖ GRN ${c.grnNumber} removed`
              : c.field === 'grnAmount'
                ? `✏️ GRN ${c.grnNumber} amount updated from ${c.oldValue} to ${c.newValue}`
                : c.field === 'grnDate'
                  ? `📅 GRN ${c.grnNumber} date changed from ${c.oldValue} to ${c.newValue}`
                  : `✏️ GRN ${c.grnNumber} updated`}
        </p>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [approveOpen, setApproveOpen] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)

  const { data: invoice, isLoading, isError } = useQuery<ReviewInvoice>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
  })

  const approveMutation = useMutation({
    mutationFn: (note: string) =>
      api.post(`/invoices/${id}/approve`, { note: note || undefined }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      toast.success('Invoice approved')
      navigate('/review')
    },
    onError: (err: unknown) => {
      type ErrShape = { response?: { data?: { error?: string; grnTotal?: number; invoiceAmount?: number } } }
      const e = err as ErrShape
      if (e.response?.data?.error === 'GRN_TOTAL_EXCEEDS_INVOICE') {
        toast.error('GRN total exceeds invoice amount', {
          description: `GRN total: ${formatIndianCurrency(e.response.data.grnTotal ?? 0)} · Invoice: ${formatIndianCurrency(e.response.data.invoiceAmount ?? 0)}`,
        })
      } else {
        toast.error(e.response?.data?.error ?? 'Failed to approve invoice')
      }
      setApproveOpen(false)
    },
  })

  const sendBackMutation = useMutation({
    mutationFn: (note: string) =>
      api.post(`/invoices/${id}/send-back`, { note }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      toast.success('Invoice sent back to uploader')
      navigate('/review')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to send back'
      toast.error(msg)
      setSendBackOpen(false)
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-2xl">
        <div className="h-6 w-40 bg-muted rounded" />
        <div className="h-48 bg-muted rounded-lg" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    )
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center py-16 gap-3">
        <XCircle size={32} className="text-destructive" />
        <p className="font-medium">Invoice not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/review')}>Back to queue</Button>
      </div>
    )
  }

  const canAct = ['pending_review', 're_submitted'].includes(invoice.status)
  const grnTotal = invoice.grnEntries.reduce((sum, g) => sum + parseFloat(g.grnAmount), 0)
  const grnExceedsInvoice = grnTotal > parseFloat(invoice.invoiceAmount)

  return (
    <div className="max-w-2xl space-y-4">
      {/* Back */}
      <button
        onClick={() => navigate('/review')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Review Queue
      </button>

      {/* Action bar */}
      {canAct && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 gap-3">
          <p className="text-sm font-medium">
            {invoice.status === 're_submitted' ? 'Re-submitted for review' : 'Awaiting your review'}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setSendBackOpen(true)}
            >
              <XCircle size={14} className="mr-1.5" />
              Send Back
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setApproveOpen(true)}
            >
              <CheckCircle2 size={14} className="mr-1.5" />
              Approve
            </Button>
          </div>
        </div>
      )}

      {/* GRN warning */}
      {grnExceedsInvoice && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-amber-800 dark:text-amber-300">
            GRN total (<strong>{formatIndianCurrency(grnTotal)}</strong>) exceeds invoice amount (
            <strong>{formatIndianCurrency(invoice.invoiceAmount)}</strong>). You cannot approve until this is resolved.
          </p>
        </div>
      )}

      {/* Invoice image preview */}
      {invoice.fileUrl && invoice.fileType === 'image' && (
        <div className="rounded-lg border overflow-hidden bg-muted">
          <img
            src={invoice.fileUrl}
            alt="Invoice"
            className="w-full object-contain max-h-96"
            onError={() => queryClient.invalidateQueries({ queryKey: ['invoice', id] })}
          />
        </div>
      )}

      {/* Invoice details */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-medium text-sm">Invoice Details</h2>
          {invoice.fileUrl && (
            <a
              href={invoice.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={13} />
              View file
            </a>
          )}
        </div>
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="font-semibold">{invoice.vendor.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">#{invoice.invoiceNumber}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className="border-transparent bg-yellow-100 text-yellow-800 text-xs">
                {invoice.status === 're_submitted' ? 'Re-submitted' : 'Pending Review'}
              </Badge>
              {invoice.versions.length > 1 && (
                <button
                  onClick={() =>
                    document.getElementById('version-history')?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="text-xs text-primary underline underline-offset-2"
                >
                  Changes made — view history
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field
              label="Invoice Amount"
              value={<span className="font-medium text-base">{formatIndianCurrency(invoice.invoiceAmount)}</span>}
            />
            <Field
              label="Invoice Date"
              value={invoice.invoiceDate ? format(parseISO(invoice.invoiceDate), 'd MMM yyyy') : '—'}
            />
            <Field label="Bill Type" value={invoice.billType === 'grn_bill' ? 'GRN Bill' : 'Miscellaneous'} />
            <Field label="Department" value={invoice.department?.name} />
            {invoice.billType === 'miscellaneous' && (
              <>
                <Field label="Category" value={invoice.miscCategory} />
                <Field label="Description" value={invoice.miscDescription} />
              </>
            )}
            <Field label="Uploaded by" value={invoice.uploader.name} />
            <Field label="Uploaded on" value={format(parseISO(invoice.createdAt), 'd MMM yyyy, HH:mm')} />
          </div>
        </div>
      </div>

      {/* GRN Entries */}
      {invoice.billType === 'grn_bill' && (
        <div className="rounded-lg border bg-card">
          <div className="px-4 py-3 border-b">
            <h2 className="font-medium text-sm">GRN Entries ({invoice.grnEntries.length})</h2>
          </div>
          <div className="px-4 py-4">
            {invoice.grnEntries.length === 0 ? (
              <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
                <Package size={22} />
                <p className="text-sm">No GRN entries linked</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invoice.grnEntries.map((grn) => (
                  <div
                    key={grn.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{grn.grnNumber}</p>
                      {grn.grnDate && (
                        <p className="text-xs text-muted-foreground">
                          {format(parseISO(grn.grnDate), 'd MMM yyyy')}
                        </p>
                      )}
                    </div>
                    <span className="text-sm tabular-nums">{formatIndianCurrency(grn.grnAmount)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t text-sm font-medium">
                  <span>GRN Total</span>
                  <span className={cn(grnExceedsInvoice && 'text-destructive')}>
                    {formatIndianCurrency(grnTotal)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Version history */}
      {invoice.versions.length > 0 && (
        <div id="version-history" className="rounded-lg border bg-card">
          <div className="px-4 py-3 border-b">
            <h2 className="font-medium text-sm">Version History</h2>
          </div>
          <div className="px-4 py-4 space-y-4">
            {invoice.versions.map((v) => (
              <div key={v.id} className="flex items-start gap-3">
                <div className="mt-0.5 h-5 w-5 flex items-center justify-center rounded-full bg-muted text-xs font-medium shrink-0">
                  {v.versionNo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{formatIndianCurrency(v.invoiceAmount)}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(v.createdAt), 'd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    by {v.changedByUser.name}
                    {v.changeReason ? ` · ${v.changeReason}` : ''}
                  </p>
                  <VersionChangeList version={v} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <ApproveDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={(note) => approveMutation.mutate(note)}
        isPending={approveMutation.isPending}
      />
      <SendBackDialog
        open={sendBackOpen}
        onClose={() => setSendBackOpen(false)}
        onConfirm={(note) => sendBackMutation.mutate(note)}
        isPending={sendBackMutation.isPending}
      />
    </div>
  )
}
