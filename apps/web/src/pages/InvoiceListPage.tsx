import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Search, SlidersHorizontal, Plus, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { InvoiceCard, type Invoice } from '@/components/invoices/InvoiceCard'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabStatus = 'all' | 'pending_review' | 'approved' | 'sent_back' | 'reconciled' | 'paid'

interface AppliedFilter {
  dateFrom: string
  dateTo: string
  billType: '' | 'grn_bill' | 'miscellaneous'
}

interface InvoiceListResponse {
  data: Invoice[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { value: TabStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent_back', label: 'Sent Back' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'paid', label: 'Paid' },
]

const EMPTY_FILTER: AppliedFilter = { dateFrom: '', dateTo: '', billType: '' }

// ── Skeleton Card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-5 w-24 bg-muted rounded-full" />
      </div>
      <div className="h-3 w-56 bg-muted rounded" />
      <div className="flex items-center justify-between">
        <div className="h-4 w-28 bg-muted rounded" />
        <div className="h-5 w-16 bg-muted rounded-full" />
      </div>
      <div className="h-3 w-32 bg-muted rounded" />
    </div>
  )
}

// ── Filter Drawer ─────────────────────────────────────────────────────────────

interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  pending: AppliedFilter
  onChange: (f: AppliedFilter) => void
  onApply: () => void
  onReset: () => void
}

function FilterDrawer({ open, onClose, pending, onChange, onApply, onReset }: FilterDrawerProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      )}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-80 bg-card border-l shadow-xl flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <span className="font-semibold text-sm">Filters</span>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date Range
            </p>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="df-from" className="text-xs">From</Label>
                <Input
                  id="df-from"
                  type="date"
                  value={pending.dateFrom}
                  onChange={(e) => onChange({ ...pending, dateFrom: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="df-to" className="text-xs">To</Label>
                <Input
                  id="df-to"
                  type="date"
                  value={pending.dateTo}
                  onChange={(e) => onChange({ ...pending, dateTo: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bill Type
            </p>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['', 'All'],
                  ['grn_bill', 'GRN Bill'],
                  ['miscellaneous', 'Miscellaneous'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onChange({ ...pending, billType: value })}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors',
                    pending.billType === value
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border-2 shrink-0',
                      pending.billType === value
                        ? 'border-primary-foreground bg-primary-foreground'
                        : 'border-muted-foreground',
                    )}
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onReset}>
            Reset
          </Button>
          <Button className="flex-1" onClick={onApply}>
            Apply
          </Button>
        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvoiceListPage() {
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<TabStatus>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pendingFilter, setPendingFilter] = useState<AppliedFilter>(EMPTY_FILTER)
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>(EMPTY_FILTER)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  function openDrawer() {
    setPendingFilter(appliedFilter)
    setDrawerOpen(true)
  }

  function applyFilter() {
    setAppliedFilter(pendingFilter)
    setDrawerOpen(false)
  }

  function resetFilter() {
    setPendingFilter(EMPTY_FILTER)
    setAppliedFilter(EMPTY_FILTER)
    setDrawerOpen(false)
  }

  const hasActiveFilter = !!(appliedFilter.dateFrom || appliedFilter.dateTo || appliedFilter.billType)

  function buildApiParams(pageParam: number): Record<string, unknown> {
    const params: Record<string, unknown> = { page: pageParam, limit: 20 }

    if (activeTab !== 'all') params.status = activeTab

    if (debouncedSearch.trim()) {
      params.search = debouncedSearch.trim()
    } else {
      if (activeTab === 'all' && !appliedFilter.dateFrom && !appliedFilter.dateTo) {
        params.dateFrom = format(startOfMonth(new Date()), 'yyyy-MM-dd')
        params.dateTo = format(endOfMonth(new Date()), 'yyyy-MM-dd')
      }
      if (appliedFilter.dateFrom) params.dateFrom = appliedFilter.dateFrom
      if (appliedFilter.dateTo) params.dateTo = appliedFilter.dateTo
    }

    if (appliedFilter.billType) params.billType = appliedFilter.billType

    return params
  }

  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useInfiniteQuery<InvoiceListResponse>({
      queryKey: ['invoices', activeTab, debouncedSearch, appliedFilter] as const,
      queryFn: ({ pageParam }) =>
        api
          .get('/invoices', { params: buildApiParams(pageParam as number) })
          .then((r) => r.data),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.pagination.page < lastPage.pagination.totalPages
          ? lastPage.pagination.page + 1
          : undefined,
      staleTime: 30_000,
    })

  const allInvoices = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])
  const totalCount = data?.pages[0]?.pagination.total ?? 0
  const isEmpty = !isLoading && allInvoices.length === 0
  const monthLabel = format(new Date(), 'MMMM yyyy')

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 min-w-0">
          {searchOpen ? (
            <div className="relative max-w-sm">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                ref={searchRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by invoice no. or vendor…"
                className="pl-8 h-9"
              />
            </div>
          ) : (
            <span className="font-semibold text-base">{monthLabel}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              if (searchOpen) {
                setSearchOpen(false)
                setSearchInput('')
              } else {
                setSearchOpen(true)
              }
            }}
            className="p-1.5 rounded-md hover:bg-accent"
            aria-label={searchOpen ? 'Close search' : 'Search invoices'}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>

          <button
            onClick={openDrawer}
            className={cn(
              'relative p-1.5 rounded-md hover:bg-accent',
              hasActiveFilter && 'text-primary',
            )}
            aria-label="Filter invoices"
          >
            <SlidersHorizontal size={18} />
            {hasActiveFilter && (
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary" />
            )}
          </button>

          <Button size="sm" onClick={() => navigate('/invoices/new')}>
            <Plus size={16} className="mr-1.5" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-0 border-b mb-4 overflow-x-auto">
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

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <div className="rounded-full bg-muted p-4">
            <FileText size={32} className="text-muted-foreground" />
          </div>
          {hasActiveFilter || debouncedSearch ? (
            <>
              <p className="font-medium">No invoices match your filters</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting or clearing your filters.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetFilter()
                  setSearchInput('')
                  setSearchOpen(false)
                }}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium">No invoices this month</p>
              <p className="text-sm text-muted-foreground">
                Upload your first invoice to get started.
              </p>
              <Button size="sm" onClick={() => navigate('/invoices/new')}>
                <Plus size={14} className="mr-1.5" />
                Upload your first invoice
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {allInvoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </div>

          <div className="mt-5 flex flex-col items-center gap-2">
            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Showing {allInvoices.length} of {totalCount} invoice
              {totalCount !== 1 ? 's' : ''}
            </p>
          </div>
        </>
      )}

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pending={pendingFilter}
        onChange={setPendingFilter}
        onApply={applyFilter}
        onReset={resetFilter}
      />
    </div>
  )
}
