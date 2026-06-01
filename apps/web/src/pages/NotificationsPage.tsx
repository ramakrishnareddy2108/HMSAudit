import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bell, CheckCircle2, XCircle, ClipboardCheck, CheckCheck, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  title: string
  message: string
  type: string
  entityType: string | null
  entityId: string | null
  isRead: boolean
  createdAt: string
}

interface NotificationsResponse {
  data: Notification[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function NotifIcon({ type }: { type: string }) {
  if (type === 'invoice_approved') {
    return <CheckCircle2 size={18} className="text-green-600 shrink-0" />
  }
  if (type === 'invoice_sent_back') {
    return <XCircle size={18} className="text-destructive shrink-0" />
  }
  if (type === 'new_review_item') {
    return <ClipboardCheck size={18} className="text-blue-600 shrink-0" />
  }
  return <Bell size={18} className="text-muted-foreground shrink-0" />
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function NotifSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5 border-b animate-pulse">
          <div className="mt-0.5 h-8 w-8 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2 py-0.5">
            <div className="h-3.5 w-40 bg-muted rounded" />
            <div className="h-3 w-3/4 bg-muted rounded" />
          </div>
          <div className="h-3 w-12 bg-muted rounded mt-0.5 shrink-0" />
        </div>
      ))}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'unread'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')

  const { data, isLoading, isError } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', filter],
    queryFn: () =>
      api
        .get('/notifications', {
          params: {
            page: 1,
            limit: 50,
            ...(filter === 'unread' ? { unreadOnly: true } : {}),
          },
        })
        .then((r) => r.data),
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.post('/notifications/mark-read', { all: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('All notifications marked as read')
    },
    onError: () => {
      toast.error('Failed to mark notifications as read')
    },
  })

  const markOneMutation = useMutation({
    mutationFn: (id: string) =>
      api.post('/notifications/mark-read', { notificationIds: [id] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  function handleClick(n: Notification) {
    if (!n.isRead) {
      markOneMutation.mutate(n.id)
    }
    if (n.entityType === 'invoice' && n.entityId) {
      navigate(`/invoices/${n.entityId}`)
    }
  }

  const notifications = data?.data ?? []
  const hasUnread = notifications.some((n) => !n.isRead)

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={markAllMutation.isPending || (!hasUnread && filter !== 'unread')}
          onClick={() => markAllMutation.mutate()}
        >
          <CheckCheck size={15} className="mr-1.5" />
          Mark all read
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg bg-muted w-fit">
        {(['all', 'unread'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
              filter === f
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <NotifSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-destructive">
            <XCircle size={28} />
            <p className="text-sm font-medium">Failed to load notifications</p>
            <p className="text-xs text-muted-foreground">Please refresh the page</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <BellOff size={28} />
            <p className="text-sm font-medium">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          notifications.map((n, i) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={cn(
                'flex items-start gap-3 px-4 py-3.5 transition-colors',
                i < notifications.length - 1 && 'border-b',
                n.entityType === 'invoice' && n.entityId
                  ? 'cursor-pointer hover:bg-muted/50'
                  : 'cursor-default',
                !n.isRead && 'bg-primary/[0.03]',
              )}
            >
              {/* Icon */}
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                <NotifIcon type={n.type} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', !n.isRead && 'font-semibold')}>{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
              </div>

              {/* Right side */}
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(n.createdAt)}
                </span>
                {!n.isRead && (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer count */}
      {data && !isLoading && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.pagination.total} notification{data.pagination.total !== 1 ? 's' : ''}
          {filter === 'unread' ? ' unread' : ''}
        </p>
      )}
    </div>
  )
}
