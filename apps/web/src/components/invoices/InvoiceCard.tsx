import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvoiceStatus =
  | 'draft'
  | 'pending_review'
  | 'sent_back'
  | 're_submitted'
  | 'approved'
  | 'reconciled'
  | 'paid'

export interface Invoice {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: string
  billType: 'grn_bill' | 'miscellaneous'
  status: InvoiceStatus
  isPriceRevised: boolean
  isDeleted: boolean
  deletedAt: string | null
  createdAt: string
  vendor: { id: string; name: string }
  department: { id: string; name: string } | null
  _count: { grnEntries: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  pending_review: {
    label: 'Pending Review',
    className:
      'border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  re_submitted: {
    label: 'Re-submitted',
    className:
      'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  sent_back: {
    label: 'Sent Back',
    className: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
  approved: {
    label: 'Approved',
    className:
      'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  reconciled: {
    label: 'Reconciled',
    className:
      'border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  paid: {
    label: 'Paid',
    className:
      'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
}

function formatIndianCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return '₹' + new Intl.NumberFormat('en-IN').format(num)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface InvoiceCardProps {
  invoice: Invoice
}

export function InvoiceCard({ invoice }: InvoiceCardProps) {
  const navigate = useNavigate()
  const status = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.draft

  const invoiceDateLabel = invoice.invoiceDate
    ? format(parseISO(invoice.invoiceDate), 'd MMM yyyy')
    : '—'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/invoices/${invoice.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/invoices/${invoice.id}`)}
      className="rounded-lg border bg-card p-4 cursor-pointer hover:bg-accent/40 transition-colors active:scale-[0.99] space-y-2 select-none"
    >
      {/* Row 1: vendor name + badges */}
      <div className="flex items-start justify-between gap-3">
        <span className={cn('font-semibold text-sm leading-snug', invoice.isDeleted && 'opacity-60')}>
          {invoice.vendor.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {invoice.isDeleted && (
            <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px] px-1.5 py-0">
              Deleted
            </Badge>
          )}
          <Badge className={cn(status.className, 'text-[10px] px-1.5 py-0')}>
            {status.label}
          </Badge>
        </div>
      </div>

      {/* Row 2: invoice number + date */}
      <p className={cn('text-xs text-muted-foreground', invoice.isDeleted && 'line-through opacity-60')}>
        #{invoice.invoiceNumber}
        <span className="mx-1.5 opacity-40">·</span>
        {invoiceDateLabel}
      </p>

      {/* Row 3: amount + GRN count or Misc Bill label */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm tabular-nums">
          {formatIndianCurrency(invoice.invoiceAmount)}
        </span>
        {invoice.billType === 'miscellaneous' ? (
          <span className="inline-flex items-center text-xs text-muted-foreground bg-muted rounded px-2 py-0.5">
            Misc Bill
          </span>
        ) : invoice._count.grnEntries > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-0.5">
            <Package size={11} />
            {invoice._count.grnEntries} GRN{invoice._count.grnEntries !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No GRNs</span>
        )}
      </div>

      {/* Row 4: department */}
      {invoice.department && (
        <p className="text-xs text-muted-foreground">{invoice.department.name}</p>
      )}
    </div>
  )
}
