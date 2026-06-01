import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ClipboardCheck, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReviewInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: string
  billType: 'grn_bill' | 'miscellaneous'
  status: 'pending_review' | 're_submitted'
  isPriceRevised: boolean
  createdAt: string
  vendor: { id: string; name: string }
  department: { id: string; name: string } | null
  uploader: { id: string; name: string }
  _count: { grnEntries: number }
}

interface ListResponse {
  data: ReviewInvoice[]
  pagination: { total: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIndianCurrency(amount: string): string {
  return '₹' + new Intl.NumberFormat('en-IN').format(parseFloat(amount))
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b last:border-0 animate-pulse">
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-40 bg-muted rounded" />
        <div className="h-3 w-56 bg-muted rounded" />
      </div>
      <div className="h-4 w-20 bg-muted rounded" />
      <div className="h-5 w-24 bg-muted rounded-full" />
    </div>
  )
}

// ── Tab toggle ────────────────────────────────────────────────────────────────

type QueueTab = 'pending_review' | 're_submitted' | 'all'

const TABS: { value: QueueTab; label: string }[] = [
  { value: 'all', label: 'All Pending' },
  { value: 'pending_review', label: 'New' },
  { value: 're_submitted', label: 'Re-submitted' },
]

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReviewQueuePage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<QueueTab>('all')
  const [search, setSearch] = useState('')

  const queryParams = {
    limit: 50,
    ...(activeTab !== 'all' ? { status: activeTab } : { status: 'pending_review,re_submitted' }),
    ...(search.trim() ? { search: search.trim() } : {}),
  }

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['review-queue', activeTab, search],
    queryFn: () =>
      activeTab === 'all'
        ? Promise.all([
            api.get('/invoices', { params: { limit: 50, status: 'pending_review', ...(search.trim() ? { search: search.trim() } : {}) } }).then((r) => r.data),
            api.get('/invoices', { params: { limit: 50, status: 're_submitted', ...(search.trim() ? { search: search.trim() } : {}) } }).then((r) => r.data),
          ]).then(([a, b]) => ({
            data: [...a.data, ...b.data].sort(
              (x: ReviewInvoice, y: ReviewInvoice) =>
                new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
            ),
            pagination: { total: a.pagination.total + b.pagination.total },
          }))
        : api.get('/invoices', { params: queryParams }).then((r) => r.data),
    staleTime: 15_000,
  })

  const invoices = data?.data ?? []
  const totalCount = data?.pagination.total ?? 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalCount} invoice{totalCount !== 1 ? 's' : ''} awaiting review
            </p>
          )}
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring w-48"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px',
              activeTab === tab.value
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <ClipboardCheck size={32} className="text-muted-foreground" />
            <p className="font-medium">No invoices in this queue</p>
            <p className="text-sm text-muted-foreground">
              {search ? 'Try a different search term.' : 'All caught up!'}
            </p>
          </div>
        ) : (
          invoices.map((invoice) => (
            <button
              key={invoice.id}
              onClick={() => navigate(`/review/${invoice.id}`)}
              className="w-full flex items-start gap-4 px-4 py-3.5 border-b last:border-0 hover:bg-accent/40 transition-colors text-left"
            >
              {/* Left: vendor + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{invoice.vendor.name}</span>
                  {invoice.isPriceRevised && (
                    <Badge className="border-transparent bg-orange-100 text-orange-800 text-[10px] px-1.5 py-0">
                      Price Revised
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  #{invoice.invoiceNumber}
                  {invoice.invoiceDate && (
                    <> · {format(parseISO(invoice.invoiceDate), 'd MMM yyyy')}</>
                  )}
                  {invoice.uploader && <> · by {invoice.uploader.name}</>}
                </p>
                {invoice.department && (
                  <p className="text-xs text-muted-foreground">{invoice.department.name}</p>
                )}
              </div>

              {/* Amount */}
              <span className="text-sm font-medium tabular-nums whitespace-nowrap">
                {formatIndianCurrency(invoice.invoiceAmount)}
              </span>

              {/* Status badge */}
              <Badge
                className={cn(
                  'text-[10px] px-2 py-0.5 border-transparent shrink-0',
                  invoice.status === 'pending_review'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-blue-100 text-blue-800',
                )}
              >
                {invoice.status === 'pending_review' ? 'New' : 'Re-submitted'}
              </Badge>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
