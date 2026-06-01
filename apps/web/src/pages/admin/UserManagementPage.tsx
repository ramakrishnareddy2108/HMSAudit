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
import { Plus, Pencil, UserX, UserCheck, Search, AlertTriangle } from 'lucide-react'
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
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type UserRole = 'role_1' | 'role_2' | 'admin'

interface Department {
  id: string
  name: string
  isActive: boolean
}

interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  departments: { id: string; department: { id: string; name: string } }[]
}

interface UserListResponse {
  data: UserRecord[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

// ── Role helpers ──────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  role_1: 'Staff',
  role_2: 'Reviewer',
  admin: 'Admin',
}

function RoleBadge({ role }: { role: UserRole }) {
  const cls =
    role === 'admin'
      ? 'bg-purple-100 text-purple-800 border-purple-200'
      : role === 'role_2'
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : 'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', cls)}>
      {ROLE_LABELS[role]}
    </span>
  )
}

// ── Form schemas ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required'),
  role: z.enum(['role_1', 'role_2', 'admin'] as const),
  departmentIds: z.array(z.string()).default([]),
})

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['role_1', 'role_2', 'admin'] as const),
  departmentIds: z.array(z.string()).default([]),
})

type InviteFormValues = z.infer<typeof inviteSchema>
type EditFormValues = z.infer<typeof editSchema>

// ── Role Radio ────────────────────────────────────────────────────────────────

interface RoleRadioProps {
  value: UserRole
  onChange: (v: UserRole) => void
  disabled?: boolean
}

function RoleRadio({ value, onChange, disabled }: RoleRadioProps) {
  const options: { val: UserRole; label: string }[] = [
    { val: 'role_1', label: 'Staff' },
    { val: 'role_2', label: 'Reviewer' },
    { val: 'admin', label: 'Admin' },
  ]
  return (
    <div className="flex gap-4">
      {options.map(({ val, label }) => (
        <label
          key={val}
          className={cn(
            'flex items-center gap-2 text-sm cursor-pointer',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <input
            type="radio"
            name="role"
            value={val}
            checked={value === val}
            onChange={() => !disabled && onChange(val)}
            disabled={disabled}
            className="accent-primary"
          />
          {label}
        </label>
      ))}
    </div>
  )
}

// ── Department Checkboxes ─────────────────────────────────────────────────────

interface DeptCheckboxesProps {
  departments: Department[]
  selected: string[]
  onChange: (ids: string[]) => void
}

function DeptCheckboxes({ departments, selected, onChange }: DeptCheckboxesProps) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  if (departments.length === 0) {
    return <p className="text-xs text-muted-foreground">No active departments found.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
      {departments.map((d) => (
        <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(d.id)}
            onChange={() => toggle(d.id)}
            className="accent-primary"
          />
          {d.name}
        </label>
      ))}
    </div>
  )
}

// ── Invite Dialog ─────────────────────────────────────────────────────────────

interface InviteDialogProps {
  open: boolean
  departments: Department[]
  onClose: () => void
}

function InviteDialog({ open, departments, onClose }: InviteDialogProps) {
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: '', email: '', role: 'role_1', departmentIds: [] },
  })

  const role = watch('role')
  const departmentIds = watch('departmentIds')

  useEffect(() => {
    if (!open) return
    reset({ name: '', email: '', role: 'role_1', departmentIds: [] })
  }, [open, reset])

  const mutation = useMutation({
    mutationFn: (v: InviteFormValues) =>
      api.post('/users/invite', {
        name: v.name,
        email: v.email,
        role: v.role,
        ...(v.role === 'role_1' && { departmentIds: v.departmentIds }),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`Invite sent to ${vars.email}`)
      onClose()
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to send invite'
      toast.error(msg)
    },
  })

  function onSubmit(v: InviteFormValues) {
    mutation.mutate(v)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invite-name"
              {...register('name')}
              placeholder="Full name"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-email">
              Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invite-email"
              {...register('email')}
              type="email"
              placeholder="user@hospital.com"
              className={cn(errors.email && 'border-destructive')}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <RoleRadio
              value={role}
              onChange={(v) => {
                setValue('role', v)
                if (v !== 'role_1') setValue('departmentIds', [])
              }}
            />
          </div>

          {role === 'role_1' && (
            <div className="space-y-1.5">
              <Label>Departments</Label>
              <DeptCheckboxes
                departments={departments}
                selected={departmentIds ?? []}
                onChange={(ids) => setValue('departmentIds', ids)}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Sending…' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

interface EditDialogProps {
  open: boolean
  user: UserRecord | null
  departments: Department[]
  currentUserId: string
  onClose: () => void
}

function EditDialog({ open, user, departments, currentUserId, onClose }: EditDialogProps) {
  const queryClient = useQueryClient()
  const isSelf = user?.id === currentUserId

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', role: 'role_1', departmentIds: [] },
  })

  const role = watch('role')
  const departmentIds = watch('departmentIds')

  useEffect(() => {
    if (!open || !user) return
    reset({
      name: user.name,
      role: user.role,
      departmentIds: user.departments.map((ud) => ud.department.id),
    })
  }, [open, user, reset])

  const mutation = useMutation({
    mutationFn: (v: EditFormValues) =>
      api.put(`/users/${user!.id}`, {
        name: v.name,
        role: v.role,
        departmentIds: v.role === 'role_1' ? v.departmentIds : [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
      onClose()
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to update user'
      toast.error(msg)
    },
  })

  function onSubmit(v: EditFormValues) {
    mutation.mutate(v)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-name"
              {...register('name')}
              placeholder="Full name"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Role {isSelf && <span className="text-xs text-muted-foreground">(cannot change your own role)</span>}</Label>
            <RoleRadio
              value={role}
              onChange={(v) => {
                setValue('role', v)
                if (v !== 'role_1') setValue('departmentIds', [])
              }}
              disabled={isSelf}
            />
          </div>

          {role === 'role_1' && (
            <div className="space-y-1.5">
              <Label>Departments</Label>
              <DeptCheckboxes
                departments={departments}
                selected={departmentIds ?? []}
                onChange={(ids) => setValue('departmentIds', ids)}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Deactivate Confirm ────────────────────────────────────────────────────────

interface DeactivateConfirmProps {
  user: UserRecord | null
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}

function DeactivateConfirm({ user, onClose, onConfirm, isPending }: DeactivateConfirmProps) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            Deactivate User?
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">{user?.name}</strong> will lose access to the system.
          </p>
          <p className="text-xs">You can reactivate this account at any time.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserManagementPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [deactivatingUser, setDeactivatingUser] = useState<UserRecord | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isError } = useQuery<UserListResponse>({
    queryKey: ['users', debouncedSearch],
    queryFn: () =>
      api
        .get('/users', { params: { search: debouncedSearch || undefined, limit: 100 } })
        .then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments-active'],
    queryFn: () => api.get('/departments', { params: { isActive: true } }).then((r) => r.data),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deactivated')
      setDeactivatingUser(null)
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to deactivate user'
      toast.error(msg)
    },
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.put(`/users/${id}`, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User activated')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Failed to activate user'
      toast.error(msg)
    },
  })

  const columns: ColumnDef<UserRecord>[] = [
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
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ getValue }) => <RoleBadge role={getValue() as UserRole} />,
    },
    {
      id: 'departments',
      header: 'Departments',
      cell: ({ row }) => {
        const depts = row.original.departments
        if (!depts.length) return <span className="text-muted-foreground text-xs">—</span>
        return (
          <span className="text-xs text-muted-foreground">
            {depts.map((ud) => ud.department.name).join(', ')}
          </span>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => {
        const active = getValue() as boolean
        return (
          <Badge variant={active ? 'default' : 'secondary'}>{active ? 'Active' : 'Inactive'}</Badge>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const u = row.original
        const isSelf = u.id === currentUser?.id
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setEditingUser(u)}
              title="Edit"
            >
              <Pencil size={14} />
            </Button>

            {u.isActive ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-destructive"
                onClick={() => setDeactivatingUser(u)}
                disabled={isSelf}
                title={isSelf ? 'Cannot deactivate your own account' : 'Deactivate'}
              >
                <UserX size={14} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-green-600"
                onClick={() => activateMutation.mutate(u.id)}
                disabled={activateMutation.isPending}
                title="Activate"
              >
                <UserCheck size={14} />
              </Button>
            )}
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus size={16} className="mr-2" />
          Invite User
        </Button>
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="pl-8"
        />
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
                  Loading users…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-destructive">
                  Failed to load users. Please refresh.
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {search ? 'No users match your search.' : 'No users found.'}
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

      {data && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.pagination.total} user{data.pagination.total !== 1 ? 's' : ''} total
          {debouncedSearch && ` · filtered by "${debouncedSearch}"`}
        </p>
      )}

      <InviteDialog
        open={inviteOpen}
        departments={departments}
        onClose={() => setInviteOpen(false)}
      />

      <EditDialog
        open={Boolean(editingUser)}
        user={editingUser}
        departments={departments}
        currentUserId={currentUser?.id ?? ''}
        onClose={() => setEditingUser(null)}
      />

      <DeactivateConfirm
        user={deactivatingUser}
        onClose={() => setDeactivatingUser(null)}
        onConfirm={() => deactivatingUser && deactivateMutation.mutate(deactivatingUser.id)}
        isPending={deactivateMutation.isPending}
      />
    </div>
  )
}
