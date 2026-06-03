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
import { Plus, Pencil, XCircle, CheckCircle, Trash2, AlertTriangle } from 'lucide-react'
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

interface Department {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  _count: { invoices: number }
}

// ── Form schema ───────────────────────────────────────────────────────────────

const deptSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
})

type DeptFormValues = z.infer<typeof deptSchema>

// ── Add / Edit Dialog ─────────────────────────────────────────────────────────

interface DeptDialogProps {
  open: boolean
  dept: Department | null
  onClose: () => void
  onSuccess: () => void
}

function DeptDialog({ open, dept, onClose, onSuccess }: DeptDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(dept)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DeptFormValues>({ resolver: zodResolver(deptSchema) })

  useEffect(() => {
    if (!open) return
    reset({ name: dept?.name ?? '' })
  }, [open, dept, reset])

  const createMutation = useMutation({
    mutationFn: (v: DeptFormValues) => api.post('/departments', v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department created')
      onSuccess()
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to create department'
      toast.error(msg)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (v: DeptFormValues) => api.put(`/departments/${dept!.id}`, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department updated')
      onSuccess()
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to update department'
      toast.error(msg)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function onSubmit(v: DeptFormValues) {
    if (isEdit) updateMutation.mutate(v)
    else createMutation.mutate(v)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Department' : 'Add Department'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="Department name"
              className={cn(errors.name && 'border-destructive')}
              autoFocus
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

interface DeptDeleteBlockers {
  activeInvoices: number
}

interface ConfirmDeleteProps {
  dept: Department | null
  blockers: DeptDeleteBlockers | null
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}

function ConfirmDelete({ dept, blockers, onClose, onConfirm, isPending }: ConfirmDeleteProps) {
  const isBlocked = blockers !== null

  return (
    <Dialog open={Boolean(dept)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-destructive" />
            Delete Department?
          </DialogTitle>
        </DialogHeader>

        {isBlocked ? (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium text-destructive">Cannot delete — blocking items exist:</p>
            <ul className="text-sm space-y-1.5 text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                {blockers!.activeInvoices} active invoice{blockers!.activeInvoices !== 1 ? 's' : ''} (draft / in-review / approved)
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">Resolve or finalise the items above, then try again.</p>
          </div>
        ) : (
          <div className="py-2 text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">{dept?.name}</strong> will be permanently removed. All user assignments will also be removed.
            </p>
            <p className="text-xs text-destructive">This action cannot be undone.</p>
          </div>
        )}

        <DialogFooter>
          {isBlocked ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
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

// ── Toggle Active Confirm ─────────────────────────────────────────────────────

interface ConfirmToggleProps {
  dept: Department | null
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}

function ConfirmToggle({ dept, onClose, onConfirm, isPending }: ConfirmToggleProps) {
  const deactivating = dept?.isActive ?? false

  return (
    <Dialog open={Boolean(dept)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            {deactivating ? 'Deactivate Department?' : 'Activate Department?'}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm text-muted-foreground space-y-2">
          {deactivating ? (
            <>
              <p>
                <strong className="text-foreground">{dept?.name}</strong> will be hidden from new
                invoice forms.
              </p>
              <p className="text-xs">You can reactivate this department at any time.</p>
            </>
          ) : (
            <p>
              <strong className="text-foreground">{dept?.name}</strong> will be restored and visible
              in invoice forms again.
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DepartmentManagementPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Department | null>(null)
  const [deletingDept, setDeletingDept] = useState<Department | null>(null)
  const [deleteBlockers, setDeleteBlockers] = useState<DeptDeleteBlockers | null>(null)

  const {
    data,
    isLoading,
    isError,
  } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
    staleTime: 1000 * 60 * 60 * 24 * 7,
  })

  const departments: Department[] = [...(data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/departments/${id}`, { isActive }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success(vars.isActive ? 'Department activated' : 'Department deactivated')
      setToggleTarget(null)
    },
    onError: (err: unknown) => {
      if ((err as { _toasted?: boolean })._toasted) return
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to update department'
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department deleted')
      setDeletingDept(null)
      setDeleteBlockers(null)
    },
    onError: (err: unknown) => {
      type ErrShape = {
        response?: { status?: number; data?: { message?: string; blockers?: DeptDeleteBlockers } }
      }
      const e = err as ErrShape
      if (e.response?.status === 409 && e.response.data?.blockers) {
        setDeleteBlockers(e.response.data.blockers)
      } else {
        setDeletingDept(null)
        if (!(err as { _toasted?: boolean })._toasted) {
          toast.error(e.response?.data?.message ?? 'Failed to delete department')
        }
      }
    },
  })

  function openAdd() {
    setEditingDept(null)
    setDialogOpen(true)
  }

  function openEdit(d: Department) {
    setEditingDept(d)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingDept(null)
  }

  function closeDelete() {
    setDeletingDept(null)
    setDeleteBlockers(null)
  }

  const columns: ColumnDef<Department>[] = [
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
      id: 'invoiceCount',
      header: 'Invoices',
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{row.original._count.invoices}</span>
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
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const d = row.original
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openEdit(d)}
              title="Edit"
            >
              <Pencil size={14} />
            </Button>
            {d.isActive ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-amber-600"
                onClick={() => setToggleTarget(d)}
                title="Deactivate"
              >
                <XCircle size={14} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-green-600"
                onClick={() => setToggleTarget(d)}
                title="Activate"
              >
                <CheckCircle size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:text-destructive"
              onClick={() => { setDeleteBlockers(null); setDeletingDept(d) }}
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
    data: departments,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Department Management</h1>
        <Button onClick={openAdd}>
          <Plus size={16} className="mr-2" />
          Add Department
        </Button>
      </div>

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
                  Loading departments…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-destructive">
                  Failed to load departments. Please refresh.
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  No departments yet. Add one to get started.
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

      {!isLoading && !isError && (
        <p className="mt-2 text-xs text-muted-foreground">
          {departments.length} department{departments.length !== 1 ? 's' : ''} total
        </p>
      )}

      <DeptDialog
        open={dialogOpen}
        dept={editingDept}
        onClose={closeDialog}
        onSuccess={closeDialog}
      />

      <ConfirmToggle
        dept={toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() =>
          toggleTarget &&
          toggleMutation.mutate({ id: toggleTarget.id, isActive: !toggleTarget.isActive })
        }
        isPending={toggleMutation.isPending}
      />

      <ConfirmDelete
        dept={deletingDept}
        blockers={deleteBlockers}
        onClose={closeDelete}
        onConfirm={() => deletingDept && deleteMutation.mutate(deletingDept.id)}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}
