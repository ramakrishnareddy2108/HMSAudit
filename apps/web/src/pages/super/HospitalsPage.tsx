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
import { Plus, Pencil, UserPlus, Users } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Hospital {
  id: string
  name: string
  isActive: boolean
  adminCount: number
  userCount: number
  vendorCount: number
  invoiceCountThisMonth: number
  createdAt: string
}

interface HospitalUser {
  id: string
  name: string
  email: string
  role: 'role_1' | 'role_2' | 'admin'
  isActive: boolean
  departments: { department: { id: string; name: string } }[]
}

// ── Form schemas ───────────────────────────────────────────────────────────────

const addHospitalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

const editHospitalSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  isActive: z.boolean().optional(),
})

const createAdminSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type AddHospitalValues = z.infer<typeof addHospitalSchema>
type EditHospitalValues = z.infer<typeof editHospitalSchema>
type CreateAdminValues = z.infer<typeof createAdminSchema>

// ── Role badge ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  role_1: 'Staff',
  role_2: 'Reviewer',
  admin: 'Admin',
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === 'admin'
      ? 'bg-purple-100 text-purple-800 border-purple-200'
      : role === 'role_2'
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : 'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', cls)}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

// ── Add Hospital dialog ────────────────────────────────────────────────────────

function AddHospitalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<AddHospitalValues>({
    resolver: zodResolver(addHospitalSchema),
  })

  useEffect(() => { if (!open) reset() }, [open, reset])

  const mutation = useMutation({
    mutationFn: (v: AddHospitalValues) => api.post('/super/hospitals', v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-hospitals'] })
      queryClient.invalidateQueries({ queryKey: ['super-hospitals-switcher'] })
      toast.success('Hospital created')
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to create hospital'
      toast.error(msg)
    },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Hospital</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-hospital-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="add-hospital-name"
              {...register('name')}
              placeholder="Hospital name"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Hospital dialog ───────────────────────────────────────────────────────

function EditHospitalDialog({
  hospital,
  onClose,
}: {
  hospital: Hospital | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } =
    useForm<EditHospitalValues>({
      resolver: zodResolver(editHospitalSchema),
    })

  const isActiveVal = watch('isActive')

  useEffect(() => {
    if (!hospital) return
    reset({ name: hospital.name, isActive: hospital.isActive })
  }, [hospital, reset])

  const mutation = useMutation({
    mutationFn: (v: EditHospitalValues) => api.put(`/super/hospitals/${hospital!.id}`, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-hospitals'] })
      queryClient.invalidateQueries({ queryKey: ['super-hospitals-switcher'] })
      toast.success('Hospital updated')
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to update hospital'
      toast.error(msg)
    },
  })

  return (
    <Dialog open={Boolean(hospital)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Hospital</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-hospital-name">Name</Label>
            <Input
              id="edit-hospital-name"
              {...register('name')}
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="edit-hospital-active"
              checked={isActiveVal ?? true}
              onChange={(e) => setValue('isActive', e.target.checked)}
              className="accent-primary"
            />
            <Label htmlFor="edit-hospital-active" className="cursor-pointer">Active</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Create Admin dialog ────────────────────────────────────────────────────────

function CreateAdminDialog({
  hospital,
  onClose,
}: {
  hospital: Hospital | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateAdminValues>({
    resolver: zodResolver(createAdminSchema),
  })

  useEffect(() => { if (!hospital) reset() }, [hospital, reset])

  const mutation = useMutation({
    mutationFn: (v: CreateAdminValues) =>
      api.post(`/super/hospitals/${hospital!.id}/admin`, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-hospitals'] })
      toast.success('Admin account created')
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to create admin'
      toast.error(msg)
    },
  })

  return (
    <Dialog open={Boolean(hospital)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Admin — {hospital?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="admin-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="admin-name"
              {...register('name')}
              placeholder="Full name"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email <span className="text-destructive">*</span></Label>
            <Input
              id="admin-email"
              {...register('email')}
              type="email"
              placeholder="admin@hospital.com"
              className={cn(errors.email && 'border-destructive')}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password <span className="text-destructive">*</span></Label>
            <Input
              id="admin-password"
              {...register('password')}
              type="password"
              placeholder="Min. 8 characters"
              className={cn(errors.password && 'border-destructive')}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create Admin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── View Users Sheet ───────────────────────────────────────────────────────────

function UsersSheet({
  hospital,
  onClose,
}: {
  hospital: Hospital | null
  onClose: () => void
}) {
  const { data: users = [], isLoading } = useQuery<HospitalUser[]>({
    queryKey: ['super-hospital-users', hospital?.id],
    queryFn: () =>
      api.get(`/super/hospitals/${hospital!.id}/users`).then((r) => r.data),
    enabled: Boolean(hospital),
  })

  return (
    <Sheet open={Boolean(hospital)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Users — {hospital?.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
            ))
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No users found.</p>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-md border p-3',
                  !u.isActive && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', !u.isActive && 'line-through')}>
                    {u.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  {u.departments.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {u.departments.map((d) => d.department.name).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <RoleBadge role={u.role} />
                  <Badge variant={u.isActive ? 'default' : 'secondary'} className="text-[10px]">
                    {u.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HospitalsPage() {
  const [addOpen, setAddOpen] = useState(false)
  const [editingHospital, setEditingHospital] = useState<Hospital | null>(null)
  const [creatingAdminFor, setCreatingAdminFor] = useState<Hospital | null>(null)
  const [viewUsersFor, setViewUsersFor] = useState<Hospital | null>(null)

  const { data = [], isLoading, isError } = useQuery<Hospital[]>({
    queryKey: ['super-hospitals'],
    queryFn: () => api.get('/super/hospitals').then((r) => r.data),
    staleTime: 30_000,
  })

  const columns: ColumnDef<Hospital>[] = [
    {
      accessorKey: 'name',
      header: 'Hospital Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => (
        <Badge variant={getValue() ? 'default' : 'secondary'}>
          {getValue() ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'adminCount',
      header: 'Admins',
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
    },
    {
      accessorKey: 'userCount',
      header: 'Users',
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
    },
    {
      accessorKey: 'vendorCount',
      header: 'Vendors',
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
    },
    {
      accessorKey: 'invoiceCountThisMonth',
      header: 'Invoices This Month',
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const h = row.original
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit"
              onClick={() => setEditingHospital(h)}
            >
              <Pencil size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Create Admin"
              onClick={() => setCreatingAdminFor(h)}
            >
              <UserPlus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="View Users"
              onClick={() => setViewUsersFor(h)}
            >
              <Users size={14} />
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Hospitals</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} className="mr-2" />
          Add Hospital
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
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: columns.length }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted animate-pulse" style={{ width: j === 0 ? 160 : 60 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-destructive">
                  Failed to load hospitals. Please refresh.
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  No hospitals found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
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

      <AddHospitalDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EditHospitalDialog hospital={editingHospital} onClose={() => setEditingHospital(null)} />
      <CreateAdminDialog hospital={creatingAdminFor} onClose={() => setCreatingAdminFor(null)} />
      <UsersSheet hospital={viewUsersFor} onClose={() => setViewUsersFor(null)} />
    </div>
  )
}
