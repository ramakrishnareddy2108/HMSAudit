import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Package,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

interface InvoiceVersion {
  id: string
  versionNo: number
  invoiceAmount: string
  statusAtChange: string
  changeReason: string | null
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
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed'
  ocrExtractedJson: Record<string, unknown> | null
  fileUrl: string | null
  currentVersionNo: number
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
  if (ocrStatus === 'done') return null

  const configs = {
    pending: {
      icon: <Clock size={15} className="shrink-0" />,
      text: 'Waiting for OCR processing to start…',
      className: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
    },
    processing: {
      icon: <RefreshCw size={15} className="shrink-0 animate-spin" />,
      text: 'OCR is processing the invoice — data will appear shortly.',
      className: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
    },
    failed: {
      icon: <XCircle size={15} className="shrink-0" />,
      text: 'OCR extraction failed. Please verify invoice details manually.',
      className: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
    },
  }

  const cfg = configs[ocrStatus]
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm', cfg.className)}>
      {cfg.icon}
      {cfg.text}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const isOcrInProgress = (status: string) => status === 'pending' || status === 'processing'

  const { data: invoice, isLoading, isError } = useQuery<InvoiceDetail>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
    // Poll while OCR is in-progress
    refetchInterval: (query) =>
      isOcrInProgress(query.state.data?.ocrStatus ?? '') ? 4000 : false,
  })

  const canEdit =
    invoice &&
    (user?.role === 'role_1' || user?.role === 'admin') &&
    !['reconciled', 'paid'].includes(invoice.status)

  const canReview =
    invoice &&
    (user?.role === 'role_2' || user?.role === 'admin') &&
    ['pending_review', 're_submitted'].includes(invoice.status)

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
        </div>
      </div>

      {/* OCR banner */}
      <OcrBanner ocrStatus={invoice.ocrStatus} />

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
            {invoice.isPriceRevised && (
              <Badge className="border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                Price Revised
              </Badge>
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
          <div className="space-y-2">
            {invoice.versions.map((v) => (
              <div key={v.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium shrink-0">
                  {v.versionNo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {formatIndianCurrency(v.invoiceAmount)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(v.createdAt), 'd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  {v.changeReason && (
                    <p className="text-xs text-muted-foreground mt-0.5">{v.changeReason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
