import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  CheckCircle2,
  XCircle,
  Package,
  Trash2,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { type InvoiceStatus } from '@/components/invoices/InvoiceCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GrnEntry {
  id: string
  grnNumber: string
  grnAmount: string
  grnDate: string | null
  status: 'pending' | 'reconciled' | 'disputed' | 'paid'
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
  fileUrl: string | null
  statusAtChange: string
  changeReason: string | null
  changeSummary: { invoiceChanges: InvoiceChangeItem[]; grnChanges: GrnChangeItem[] } | null
  grnSnapshot: GrnSnapshotItem[] | null
  changedByUser: { id: string; name: string }
  createdAt: string
}

interface InvoiceDetail {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: string
  billType: 'grn_bill' | 'miscellaneous'
  miscCategory: string | null
  miscDescription: string | null
  status: InvoiceStatus
  isPriceRevised: boolean
  isDeleted: boolean
  deletedAt: string | null
  deletedBy: string | null
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed'
  ocrExtractedJson: Record<string, unknown> | null
  fileUrl: string | null
  fileType: 'image' | 'pdf' | null
  currentVersionNo: number
  uploadedBy: string
  reviewerNote: string | null
  createdAt: string
  vendor: { id: string; name: string; phone: string | null; email: string | null }
  department: { id: string; name: string } | null
  uploader: { id: string; name: string; email: string }
  reviewer: { id: string; name: string } | null
  grnEntries: GrnEntry[]
  versions: InvoiceVersion[]
  _count: { grnEntries: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIndianCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return '₹' + new Intl.NumberFormat('en-IN').format(num)
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-transparent bg-gray-100 text-gray-700' },
  pending_review: { label: 'Pending Review', className: 'border-transparent bg-yellow-100 text-yellow-800' },
  re_submitted: { label: 'Re-submitted', className: 'border-transparent bg-blue-100 text-blue-800' },
  sent_back: { label: 'Sent Back', className: 'border-transparent bg-red-100 text-red-800' },
  approved: { label: 'Approved', className: 'border-transparent bg-green-100 text-green-800' },
  reconciled: { label: 'Reconciled', className: 'border-transparent bg-indigo-100 text-indigo-800' },
  paid: { label: 'Paid', className: 'border-transparent bg-emerald-100 text-emerald-800' },
}

const GRN_STATUS_CONFIG = {
  pending: 'bg-yellow-100 text-yellow-800',
  reconciled: 'bg-indigo-100 text-indigo-800',
  disputed: 'bg-red-100 text-red-800',
  paid: 'bg-emerald-100 text-emerald-800',
}

// ── OCR Status Banner ─────────────────────────────────────────────────────────

function OcrBanner({ ocrStatus }: { ocrStatus: InvoiceDetail['ocrStatus'] }) {
  if (ocrStatus !== 'failed') return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
      <XCircle size={15} className="shrink-0" />
      OCR extraction failed. Please verify invoice details manually.
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="font-medium text-sm">{title}</h2>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? '—'}</p>
    </div>
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

function VersionHistoryItem({ version }: { version: InvoiceVersion }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium shrink-0">
        {version.versionNo}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{formatIndianCurrency(version.invoiceAmount)}</span>
          <span className="text-xs text-muted-foreground">
            {format(parseISO(version.createdAt), 'd MMM yyyy, HH:mm')}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          by {version.changedByUser.name}
          {version.changeReason ? ` · ${version.changeReason}` : ''}
        </p>
        <VersionChangeList version={version} />
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isSuperAdminUser } = useAuthStore()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const { data: invoice, isLoading, isError } = useQuery<InvoiceDetail>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success('Invoice deleted')
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      navigate('/invoices')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to delete invoice'
      toast.error(message)
    },
  })

  const isAdminUser = user?.role === 'admin' || isSuperAdminUser()

  const canEdit =
    invoice &&
    !invoice.isDeleted &&
    (user?.role === 'role_1' || user?.role === 'admin') &&
    !['reconciled', 'paid'].includes(invoice.status)

  const canReview =
    invoice &&
    !invoice.isDeleted &&
    (user?.role === 'role_2' || user?.role === 'admin') &&
    ['pending_review', 're_submitted'].includes(invoice.status)

  const canDelete =
    invoice &&
    !invoice.isDeleted &&
    (
      (user?.role === 'role_1' &&
        invoice.uploadedBy === user.id &&
        !invoice.grnEntries.some((g) => g.status === 'reconciled' || g.status === 'paid')) ||
      isAdminUser
    )

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
        <div className="h-40 bg-muted rounded-lg" />
      </div>
    )
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <XCircle size={32} className="text-destructive" />
        <p className="font-medium">Invoice not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/invoices')}>
          Back to invoices
        </Button>
      </div>
    )
  }

  const status = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.draft
  const grnTotal = invoice.grnEntries.reduce((sum, g) => sum + parseFloat(g.grnAmount), 0)

  return (
    <div className="max-w-2xl space-y-4">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Invoices
        </button>
        <div className="flex items-center gap-2">
          {invoice.fileUrl && (
            <a
              href={invoice.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={15} />
              View file
            </a>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
            >
              <Pencil size={14} className="mr-1.5" />
              {invoice.status === 'sent_back' ? 'Resubmit' : 'Edit'}
            </Button>
          )}
          {canReview && (
            <Button size="sm" onClick={() => navigate(`/review/${invoice.id}`)}>
              Review
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 size={14} className="mr-1.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Deleted banner (admin view) */}
      {invoice.isDeleted && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3 text-sm">
          <AlertCircle size={15} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">Invoice deleted</p>
            {invoice.deletedAt && (
              <p className="text-red-700 dark:text-red-400 mt-0.5">
                Deleted on {format(parseISO(invoice.deletedAt), 'd MMM yyyy, HH:mm')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* OCR banner */}
      <OcrBanner ocrStatus={invoice.ocrStatus} />

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

      {/* Sent-back note */}
      {invoice.status === 'sent_back' && invoice.reviewerNote && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3 text-sm">
          <XCircle size={15} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">Sent back by reviewer</p>
            <p className="text-red-700 dark:text-red-400 mt-0.5">{invoice.reviewerNote}</p>
          </div>
        </div>
      )}

      {/* Approved note */}
      {invoice.status === 'approved' && invoice.reviewerNote && (
        <div className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 px-4 py-3 text-sm">
          <CheckCircle2 size={15} className="text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <p className="text-green-800 dark:text-green-300">{invoice.reviewerNote}</p>
        </div>
      )}

      {/* Header card */}
      <Section title="Invoice Details">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="font-semibold">{invoice.vendor.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">#{invoice.invoiceNumber}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge className={cn(status.className, 'text-xs')}>
              {status.label}
            </Badge>
            {invoice.versions.length > 1 && (
              <span className="text-xs text-muted-foreground">v{invoice.currentVersionNo}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field
            label="Invoice Amount"
            value={
              <span className="font-medium text-base">
                {formatIndianCurrency(invoice.invoiceAmount)}
              </span>
            }
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
          {invoice.reviewer && (
            <Field label="Reviewed by" value={invoice.reviewer.name} />
          )}
        </div>
      </Section>

      {/* OCR extracted data */}
      {invoice.ocrStatus === 'done' && invoice.ocrExtractedJson && (
        <Section title="OCR Extracted Data">
          <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(invoice.ocrExtractedJson, null, 2)}
          </pre>
        </Section>
      )}

      {/* GRN Entries */}
      {invoice.billType === 'grn_bill' && (
        <Section title={`GRN Entries (${invoice.grnEntries.length})`}>
          {invoice.grnEntries.length === 0 ? (
            <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
              <Package size={24} />
              <p className="text-sm">No GRN entries linked yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {invoice.grnEntries.map((grn) => (
                <div
                  key={grn.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{grn.grnNumber}</p>
                    {grn.grnDate && (
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(grn.grnDate), 'd MMM yyyy')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums">
                      {formatIndianCurrency(grn.grnAmount)}
                    </span>
                    <Badge className={cn('text-xs border-transparent', GRN_STATUS_CONFIG[grn.status])}>
                      {grn.status}
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t text-sm">
                <span className="text-muted-foreground">GRN Total</span>
                <span className="font-medium">{formatIndianCurrency(grnTotal)}</span>
              </div>
              {grnTotal > parseFloat(invoice.invoiceAmount) && (
                <p className="text-xs text-destructive">
                  GRN total exceeds invoice amount by{' '}
                  {formatIndianCurrency(grnTotal - parseFloat(invoice.invoiceAmount))}
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Version history */}
      {invoice.versions.length > 0 && (
        <Section title="Version History">
          <div className="space-y-4">
            {invoice.versions.map((v) => (
              <VersionHistoryItem key={v.id} version={v} />
            ))}
          </div>
        </Section>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Invoice {invoice.invoiceNumber}?</DialogTitle>
            <DialogDescription>
              This will also remove all pending GRN entries. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
