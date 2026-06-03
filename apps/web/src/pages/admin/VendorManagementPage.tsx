import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Pencil, XCircle, CheckCircle, Trash2, Search, AlertTriangle } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  gstNumber: string | null
  bankName: string | null
  bankAccountNumber: string | null
  bankIfscCode: string | null
  bankAccountName: string | null
  bankBranch: string | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  _count: { invoices: number }
}

interface VendorListResponse {
  data: Vendor[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface DeleteBlockers {
  activeInvoices: number
  unpaidGrns: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskAccount(n: string | null): string {
  if (!n) return '—'
  return n.length > 4 ? `••••${n.slice(-4)}` : '••••'
}

// ── Form schema ───────────────────────────────────────────────────────────────

const PHONE_RE = /^[6-9]\d{9}$/
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

const vendorSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    contactName: z.string().optional(),
    phone: z
      .union([z.literal(''), z.string().regex(PHONE_RE, 'Valid 10-digit mobile (e.g. 9876543210)')])
      .optional(),
    email: z.union([z.literal(''), z.string().email('Invalid email')]).optional(),
    gstNumber: z
      .union([z.literal(''), z.string().regex(GST_RE, 'Invalid GST (e.g. 22ABCDE1234F1Z5)')])
      .optional(),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankIfscCode: z
      .union([z.literal(''), z.string().regex(IFSC_RE, 'Invalid IFSC (e.g. HDFC0001234)')])
      .optional(),
    bankAccountName: z.string().optional(),
    bankBranch: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const required = [data.bankName, data.bankAccountNumber, data.bankIfscCode, data.bankAccountName]
    const filled = required.filter((v) => v && v.trim()).length
    if (filled > 0 && filled < 4) {
      const msg = 'Fill all four bank fields or leave all empty'
      ;(['bankName', 'bankAccountNumber', 'bankIfscCode', 'bankAccountName'] as const).forEach(
        (field) => {
          if (!data[field]?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: [field] })
          }
        },
      )
    }
  })

type VendorFormValues = z.infer<typeof vendorSchema>

// ── Vendor Dialog (Add / Edit) ────────────────────────────────────────────────

interface VendorDialogProps {
  open: boolean
  vendor: Vendor | null
  onClose: () => void
  onSuccess: () => void
}

function VendorDialog({ open, vendor, onClose, onSuccess }: VendorDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(vendor)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VendorFormValues>({ resolver: zodResolver(vendorSchema) })

  useEffect(() => {
    if (!open) return
    reset({
      name: vendor?.name ?? '',
      contactName: vendor?.contactName ?? '',
      phone: vendor?.phone ?? '',
      email: vendor?.email ?? '',
      gstNumber: vendor?.gstNumber ?? '',
      bankName: vendor?.bankName ?? '',
      bankAccountNumber: vendor?.bankAccountNumber ?? '',
      bankIfscCode: vendor?.bankIfscCode ?? '',
      bankAccountName: vendor?.bankAccountName ?? '',
      bankBranch: vendor?.bankBranch ?? '',
    })
  }, [open, vendor, reset])

  function buildPayload(v: VendorFormValues) {
    const p: Record<string, unknown> = { name: v.name }
    if (v.contactName?.trim()) p.contactName = v.contactName.trim()
    if (v.phone?.trim()) p.phone = v.phone.trim()
    if (v.email?.trim()) p.email = v.email.trim()
    if (v.gstNumber?.trim()) p.gstNumber = v.gstNumber.trim()
    if (v.bankName?.trim()) p.bankName = v.bankName.trim()
    if (v.bankAccountNumber?.trim()) p.bankAccountNumber = v.bankAccountNumber.trim()
    if (v.bankIfscCode?.trim()) p.bankIfscCode = v.bankIfscCode.trim().toUpperCase()
    if (v.bankAccountName?.trim()) p.bankAccountName = v.bankAccountName.trim()
    if (v.bankBranch?.trim()) p.bankBranch = v.bankBranch.trim()
    return p
  }

  const createMutation = useMutation({
    mutationFn: (v: VendorFormValues) => api.post('/vendors', buildPayload(v)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor created')
      onSuccess()
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to create vendor'
      toast.error(msg)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (v: VendorFormValues) => api.put(`/vendors/${vendor!.id}`, buildPayload(v)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor updated')
      onSuccess()
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to update vendor'
      toast.error(msg)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function onSubmit(v: VendorFormValues) {
    if (isEdit) updateMutation.mutate(v)
    else createMutation.mutate(v)
  }

  // Field-level error helper
  function err(field: keyof VendorFormValues) {
    return errors[field]?.message
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="Vendor name"
              className={cn(errors.name && 'border-destructive')}
            />
            {err('name') && <p className="text-xs text-destructive">{err('name')}</p>}
          </div>

          {/* Contact + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contactName">Contact Person</Label>
              <Input id="contactName" {...register('contactName')} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                {...register('phone')}
                placeholder="9876543210"
                maxLength={10}
                className={cn(errors.phone && 'border-destructive')}
              />
              {err('phone') && <p className="text-xs text-destructive">{err('phone')}</p>}
            </div>
          </div>

          {/* Email + GST */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                {...register('email')}
                type="email"
                placeholder="vendor@example.com"
                className={cn(errors.email && 'border-destructive')}
              />
              {err('email') && <p className="text-xs text-destructive">{err('email')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input
                id="gstNumber"
                {...register('gstNumber')}
                placeholder="22ABCDE1234F1Z5"
                maxLength={15}
                className={cn('font-mono', errors.gstNumber && 'border-destructive')}
              />
              {err('gstNumber') && <p className="text-xs text-destructive">{err('gstNumber')}</p>}
            </div>
          </div>

          {/* ── Bank Details ── */}
          <div className="space-y-3 pt-1">
            <div>
              <p className="text-sm font-medium">Bank Details</p>
              <p className="text-xs text-muted-foreground">Fill all four fields or leave all empty</p>
            </div>

            {/* Bank Name + Account Number */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input
                  id="bankName"
                  {...register('bankName')}
                  placeholder="HDFC Bank"
                  className={cn(errors.bankName && 'border-destructive')}
                />
                {err('bankName') && <p className="text-xs text-destructive">{err('bankName')}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bankAccountNumber">Account Number</Label>
                <Input
                  id="bankAccountNumber"
                  {...register('bankAccountNumber')}
                  placeholder="50100123456789"
                  className={cn('font-mono', errors.bankAccountNumber && 'border-destructive')}
                />
                {err('bankAccountNumber') && (
                  <p className="text-xs text-destructive">{err('bankAccountNumber')}</p>
                )}
              </div>
            </div>

            {/* Account Holder Name + IFSC */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bankAccountName">Account Holder Name</Label>
                <Input
                  id="bankAccountName"
                  {...register('bankAccountName')}
                  placeholder="M/s Vendor Pvt Ltd"
                  className={cn(errors.bankAccountName && 'border-destructive')}
                />
                {err('bankAccountName') && (
                  <p className="text-xs text-destructive">{err('bankAccountName')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bankIfscCode">IFSC Code</Label>
                <Input
                  id="bankIfscCode"
                  {...register('bankIfscCode')}
                  placeholder="HDFC0001234"
                  maxLength={11}
                  onInput={(e) => {
                    const t = e.target as HTMLInputElement
                    t.value = t.value.toUpperCase()
                  }}
                  className={cn('font-mono', errors.bankIfscCode && 'border-destructive')}
                />
                {err('bankIfscCode') && (
                  <p className="text-xs text-destructive">{err('bankIfscCode')}</p>
                )}
              </div>
            </div>

            {/* Branch (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="bankBranch">Branch (optional)</Label>
              <Input
                id="bankBranch"
                {...register('bankBranch')}
                placeholder="Koramangala, Bengaluru"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Update Vendor' : 'Create Vendor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Toggle Active Confirm ─────────────────────────────────────────────────────

interface ConfirmToggleProps {
  vendor: Vendor | null
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}

function ConfirmToggle({ vendor, onClose, onConfirm, isPending }: ConfirmToggleProps) {
  const deactivating = vendor?.isActive ?? false

  return (
    <Dialog open={Boolean(vendor)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            {deactivating ? 'Deactivate Vendor?' : 'Activate Vendor?'}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm text-muted-foreground space-y-2">
          {deactivating ? (
            <>
              <p>
                <strong className="text-foreground">{vendor?.name}</strong> will be hidden from new
                invoice forms.
              </p>
              <p className="text-xs">You can reactivate this vendor at any time.</p>
            </>
          ) : (
            <p>
              <strong className="text-foreground">{vendor?.name}</strong> will be restored and
              visible in invoice forms again.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={deactivating ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending
              ? deactivating
                ? 'Deactivating…'
                : 'Activating…'
              : deactivating
                ? 'Deactivate'
                : 'Activate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

interface ConfirmDeleteProps {
  vendor: Vendor | null
  blockers: DeleteBlockers | null
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}

// TODO: Once invoice list (Prompt 09) and payments page (Prompt 10) are built,
// add direct links here so admins can navigate straight to the blocking items
// and resolve them without leaving the vendor management page.
function ConfirmDelete({ vendor, blockers, onClose, onConfirm, isPending }: ConfirmDeleteProps) {
  const isBlocked = blockers !== null

  return (
    <Dialog open={Boolean(vendor)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-destructive" />
            Delete Vendor?
          </DialogTitle>
        </DialogHeader>

        {isBlocked ? (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium text-destructive">
              Cannot delete — blocking items exist:
            </p>
            <ul className="text-sm space-y-1.5 text-muted-foreground">
              {blockers!.activeInvoices > 0 && (
                <li className="flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  {blockers!.activeInvoices} active invoice
                  {blockers!.activeInvoices !== 1 ? 's' : ''} (draft / in-review / approved)
                </li>
              )}
              {blockers!.unpaidGrns > 0 && (
                <li className="flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  {blockers!.unpaidGrns} reconciled but unpaid GRN
                  {blockers!.unpaidGrns !== 1 ? 's' : ''}
                </li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              Resolve or finalise the items above, then try again.
            </p>
          </div>
        ) : (
          <div className="py-2 text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">{vendor?.name}</strong> will be permanently
              removed from the system.
            </p>
            <p className="text-xs text-destructive">This action cannot be undone.</p>
          </div>
        )}

        <DialogFooter>
          {isBlocked ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                {isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorManagementPage() {
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Vendor | null>(null)
  const [deletingVendor, setDeletingVendor] = useState<Vendor | null>(null)
  const [deleteBlockers, setDeleteBlockers] = useState<DeleteBlockers | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isError } = useQuery<VendorListResponse>({
    queryKey: ['vendors', debouncedSearch],
    queryFn: () =>
      api
        .get('/vendors', { params: { search: debouncedSearch || undefined, limit: 100 } })
        .then((r) => r.data),
    staleTime: 1000 * 60 * 60 * 24 * 7,
  })

  // Activate / Deactivate via PUT with isActive toggle
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/vendors/${id}`, { isActive }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success(vars.isActive ? 'Vendor activated' : 'Vendor deactivated')
      setToggleTarget(null)
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to update vendor'
      toast.error(msg)
    },
  })

  // Delete with blocking check
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vendors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor deleted')
      setDeletingVendor(null)
      setDeleteBlockers(null)
    },
    onError: (err: unknown) => {
      type ErrShape = {
        response?: {
          status?: number
          data?: { error?: string; blockers?: DeleteBlockers }
        }
      }
      const e = err as ErrShape
      if (e.response?.status === 409 && e.response.data?.blockers) {
        setDeleteBlockers(e.response.data.blockers)
      } else {
        setDeletingVendor(null)
        if (!(err as { _toasted?: boolean })._toasted) {
          toast.error(e.response?.data?.error ?? 'Failed to delete vendor')
        }
      }
    },
  })

  function openAdd() {
    setEditingVendor(null)
    setDialogOpen(true)
  }

  function openEdit(v: Vendor) {
    setEditingVendor(v)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingVendor(null)
  }

  function closeDelete() {
    setDeletingVendor(null)
    setDeleteBlockers(null)
  }

  const columns: ColumnDef<Vendor>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <span
          className={cn(
            'font-medium',
            !row.original.isActive && 'line-through text-muted-foreground',
          )}
        >
          {row.original.name}
        </span>
      ),
    },
    {
      accessorKey: 'contactName',
      header: 'Contact',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{(getValue() as string | null) ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ getValue }) => <span>{(getValue() as string | null) ?? '—'}</span>,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => <span>{(getValue() as string | null) ?? '—'}</span>,
    },
    {
      accessorKey: 'gstNumber',
      header: 'GST',
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{(getValue() as string | null) ?? '—'}</span>
      ),
    },
    {
      id: 'bankAccount',
      header: 'Bank A/C',
      cell: ({ row }) => (
        <span className="font-mono text-xs tracking-wider">
          {maskAccount(row.original.bankAccountNumber)}
        </span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => {
        const active = getValue() as boolean
        return (
          <Badge variant={active ? 'default' : 'secondary'}>
            {active ? 'Active' : 'Inactive'}
          </Badge>
        )
      },
    },
    {
      id: 'invoiceCount',
      header: 'Invoices',
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{row.original._count.invoices}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const v = row.original
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openEdit(v)}
              title="Edit"
            >
              <Pencil size={14} />
            </Button>

            {v.isActive ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-amber-600"
                onClick={() => setToggleTarget(v)}
                title="Deactivate"
              >
                <XCircle size={14} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-green-600"
                onClick={() => setToggleTarget(v)}
                title="Activate"
              >
                <CheckCircle size={14} />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:text-destructive"
              onClick={() => { setDeleteBlockers(null); setDeletingVendor(v) }}
              title="Delete"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Vendor Management</h1>
        <Button onClick={openAdd}>
          <Plus size={16} className="mr-2" />
          Add Vendor
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-xs">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendors…"
          className="pl-8"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
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
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  Loading vendors…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-destructive">
                  Failed to load vendors. Please refresh.
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {search ? 'No vendors match your search.' : 'No vendors yet. Add one to get started.'}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/30',
                    !row.original.isActive && 'opacity-60',
                  )}
                >
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

      {/* Footer count */}
      {data && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.pagination.total} vendor{data.pagination.total !== 1 ? 's' : ''} total
          {debouncedSearch && ` · filtered by "${debouncedSearch}"`}
        </p>
      )}

      {/* Add / Edit dialog */}
      <VendorDialog
        open={dialogOpen}
        vendor={editingVendor}
        onClose={closeDialog}
        onSuccess={closeDialog}
      />

      {/* Activate / Deactivate confirm */}
      <ConfirmToggle
        vendor={toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() =>
          toggleTarget &&
          toggleMutation.mutate({ id: toggleTarget.id, isActive: !toggleTarget.isActive })
        }
        isPending={toggleMutation.isPending}
      />

      {/* Delete confirm (with blocker details on 409) */}
      <ConfirmDelete
        vendor={deletingVendor}
        blockers={deleteBlockers}
        onClose={closeDelete}
        onConfirm={() => deletingVendor && deleteMutation.mutate(deletingVendor.id)}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}
