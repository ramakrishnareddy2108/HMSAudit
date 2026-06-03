import { useState, useEffect, useRef, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Upload,
  FileText,
  X,
  Lock,
  Pencil,
  Trash2,
  Plus,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  status: 'pending' | 'reconciled' | 'paid'
}

interface Department {
  id: string
  name: string
  isActive: boolean
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
  departmentId: string | null
  department: { id: string; name: string } | null
  vendor: { id: string; name: string }
  fileUrl: string | null
  grnEntries: GrnEntry[]
}

interface GrnCheckResult {
  isDuplicate: boolean
  existing?: {
    invoiceId: string
    invoiceNumber: string
    vendorName: string
  }
}

// ── Schema ────────────────────────────────────────────────────────────────────

const formSchema = z.object({
  invoiceDate: z.string().optional(),
  invoiceAmount: z
    .string()
    .min(1, 'Amount is required')
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Enter a valid positive amount'),
  departmentId: z.string().optional(),
  changeReason: z.string().min(1, 'Please explain the reason for this revision'),
})

type FormValues = z.infer<typeof formSchema>

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

function humanSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtINR(n: number): string {
  if (isNaN(n)) return '₹—'
  return '₹' + new Intl.NumberFormat('en-IN').format(n)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// ── GRN row edit state ────────────────────────────────────────────────────────

interface GrnEditState {
  grnNumber: string
  grnAmount: string
  grnDate: string
}

interface UpdateGrnBody {
  grnNumber?: string
  grnAmount?: number
  grnDate?: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin === true
  const isRole1 = user?.role === 'role_1'

  // ── File state ───────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── GRN local state ──────────────────────────────────────────────────────
  const [grnEntries, setGrnEntries] = useState<GrnEntry[]>([])
  const [editingGrnId, setEditingGrnId] = useState<string | null>(null)
  const [adminOverrideGrnId, setAdminOverrideGrnId] = useState<string | null>(null)
  const [editGrnState, setEditGrnState] = useState<GrnEditState>({ grnNumber: '', grnAmount: '', grnDate: '' })
  const [editGrnError, setEditGrnError] = useState('')
  const [editGrnDupKey, setEditGrnDupKey] = useState('')

  // New GRN add form
  const [addForm, setAddForm] = useState({ grnNumber: '', grnAmount: '', grnDate: '' })
  const [addFormError, setAddFormError] = useState('')
  const [addGrnCheckKey, setAddGrnCheckKey] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: invoice, isLoading, isError } = useQuery<InvoiceDetail>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
  })

  const { data: allDepartments = [] } = useQuery<Department[]>({
    queryKey: ['departments-all'],
    queryFn: () => api.get('/departments', { params: { isActive: true } }).then((r) => r.data),
    enabled: isAdmin,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  })

  // Duplicate check for edit row
  const { data: editGrnDupResult } = useQuery<GrnCheckResult>({
    queryKey: ['grn-check', editGrnDupKey],
    queryFn: () => api.get('/grns/check', { params: { grnNumber: editGrnDupKey } }).then((r) => r.data),
    enabled: !!editGrnDupKey,
    staleTime: 5_000,
    retry: false,
  })

  // Duplicate check for add form
  const { data: addGrnDupResult } = useQuery<GrnCheckResult>({
    queryKey: ['grn-check', addGrnCheckKey],
    queryFn: () => api.get('/grns/check', { params: { grnNumber: addGrnCheckKey } }).then((r) => r.data),
    enabled: !!addGrnCheckKey,
    staleTime: 5_000,
    retry: false,
  })

  // ── Form ─────────────────────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  const watchedAmount = watch('invoiceAmount')

  useEffect(() => {
    if (!invoice) return
    reset({
      invoiceDate: invoice.invoiceDate?.slice(0, 10) ?? '',
      invoiceAmount: invoice.invoiceAmount,
      departmentId: invoice.departmentId ?? '',
      changeReason: '',
    })
    setGrnEntries(invoice.grnEntries ?? [])
  }, [invoice, reset])

  // Debounce add-form GRN check
  useEffect(() => {
    if (!addForm.grnNumber.trim()) { setAddGrnCheckKey(''); return }
    const t = setTimeout(() => setAddGrnCheckKey(addForm.grnNumber.trim()), 600)
    return () => clearTimeout(t)
  }, [addForm.grnNumber])

  // Debounce edit-row GRN check
  useEffect(() => {
    if (!editGrnState.grnNumber.trim()) { setEditGrnDupKey(''); return }
    const t = setTimeout(() => setEditGrnDupKey(editGrnState.grnNumber.trim()), 600)
    return () => clearTimeout(t)
  }, [editGrnState.grnNumber])

  // ── GRN mutations ─────────────────────────────────────────────────────────

  const addGrnMutation = useMutation({
    mutationFn: (body: { grnNumber: string; grnAmount: number; grnDate?: string }) =>
      api.post(`/invoices/${id}/grns`, body).then((r) => r.data as GrnEntry),
    onSuccess: (newGrn) => {
      setGrnEntries((prev) => [...prev, newGrn])
      setAddForm({ grnNumber: '', grnAmount: '', grnDate: '' })
      setAddFormError('')
      setAddGrnCheckKey('')
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to add GRN'
      setAddFormError(msg === 'GRN_DUPLICATE' ? 'This GRN number already exists on another invoice.' : msg)
    },
  })

  const updateGrnMutation = useMutation({
    mutationFn: ({ grnId, body }: { grnId: string; body: UpdateGrnBody }) =>
      api.put(`/invoices/${id}/grns/${grnId}`, body).then((r) => r.data as GrnEntry),
    onSuccess: (updated) => {
      setGrnEntries((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      setEditingGrnId(null)
      setEditGrnError('')
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to update GRN'
      setEditGrnError(msg === 'GRN_DUPLICATE' ? 'This GRN number already exists on another invoice.' : msg)
    },
  })

  const deleteGrnMutation = useMutation({
    mutationFn: (grnId: string) =>
      api.delete(`/invoices/${id}/grns/${grnId}`).then((r) => r.data),
    onSuccess: (_data, grnId) => {
      setGrnEntries((prev) => prev.filter((g) => g.id !== grnId))
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to delete GRN'
      toast.error(msg)
    },
  })

  // ── Invoice update mutation ───────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const formData = new FormData()
      if (file) formData.append('file', file)

      const data: Record<string, unknown> = {
        invoiceAmount: parseFloat(values.invoiceAmount),
        changeReason: values.changeReason.trim(),
      }
      if (values.invoiceDate) data.invoiceDate = values.invoiceDate
      if (values.departmentId?.trim()) data.departmentId = values.departmentId

      formData.append('data', JSON.stringify(data))

      return api
        .put(`/invoices/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        .then((r) => r.data)
    },
    onSuccess: () => {
      toast.success('Invoice revised and resubmitted for review')
      navigate(`/invoices/${id}`)
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        'Failed to update invoice'
      toast.error(msg)
    },
  })

  // ── File handlers ────────────────────────────────────────────────────────

  function handleFile(f: File) {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setFileError('Only JPEG, PNG, WebP or PDF files are accepted.')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setFileError('File must be under 10 MB.')
      return
    }
    setFileError('')
    setFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // ── GRN handlers ─────────────────────────────────────────────────────────

  function handleAddGrn() {
    const { grnNumber, grnAmount } = addForm
    if (!grnNumber.trim()) { setAddFormError('GRN number is required.'); return }
    const amount = parseFloat(grnAmount)
    if (!grnAmount || isNaN(amount) || amount <= 0) { setAddFormError('Enter a valid positive amount.'); return }

    const dupOnOther = addGrnDupResult?.isDuplicate && addGrnDupResult.existing?.invoiceId !== id
    if (dupOnOther) { setAddFormError('This GRN number already exists on another invoice.'); return }

    addGrnMutation.mutate({
      grnNumber: grnNumber.trim(),
      grnAmount: amount,
      ...(addForm.grnDate ? { grnDate: addForm.grnDate } : {}),
    })
  }

  function startEditGrn(grn: GrnEntry) {
    setEditingGrnId(grn.id)
    setEditGrnState({
      grnNumber: grn.grnNumber,
      grnAmount: grn.grnAmount,
      grnDate: grn.grnDate?.slice(0, 10) ?? '',
    })
    setEditGrnError('')
    setEditGrnDupKey('')
  }

  function cancelEditGrn() {
    setEditingGrnId(null)
    setEditGrnError('')
    setEditGrnDupKey('')
  }

  function saveEditGrn(grnId: string, originalGrnNumber: string) {
    const { grnNumber, grnAmount, grnDate } = editGrnState
    if (!grnNumber.trim()) { setEditGrnError('GRN number is required.'); return }
    const amount = parseFloat(grnAmount)
    if (isNaN(amount) || amount <= 0) { setEditGrnError('Enter a valid positive amount.'); return }

    const dupOnOther =
      editGrnDupResult?.isDuplicate &&
      editGrnDupResult.existing?.invoiceId !== id &&
      grnNumber.trim() !== originalGrnNumber

    if (dupOnOther) { setEditGrnError('This GRN number already exists on another invoice.'); return }

    updateGrnMutation.mutate({
      grnId,
      body: {
        grnNumber: grnNumber.trim(),
        grnAmount: amount,
        grnDate: grnDate || null,
      },
    })
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const invoiceAmountNum = parseFloat(invoice?.invoiceAmount ?? '0')
  const grnTotal = grnEntries.reduce((s, g) => s + parseFloat(g.grnAmount ?? '0'), 0)
  const grnRemaining = invoiceAmountNum - grnTotal
  const grnOverBudget = grnTotal > invoiceAmountNum + 0.001

  const isLocked = invoice && ['reconciled', 'paid'].includes(invoice.status)
  const isSentBack = invoice?.status === 'sent_back'
  const isCorrectionMode = isSentBack || mode === 'correction'
  const isRevisionMode = !isCorrectionMode
  const amountChanged =
    !!invoice &&
    watchedAmount !== undefined &&
    watchedAmount !== '' &&
    Math.abs(parseFloat(watchedAmount) - parseFloat(invoice.invoiceAmount)) > 0.01

  // ── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-2xl">
        <div className="h-6 w-40 bg-muted rounded" />
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-40 bg-muted rounded-lg" />
      </div>
    )
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="font-medium text-destructive">Invoice not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/invoices')}>
          Back to invoices
        </Button>
      </div>
    )
  }

  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="font-medium">This invoice cannot be edited (status: {invoice.status})</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/${id}`)}>
          Back to invoice
        </Button>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/invoices/${id}`)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Invoice
        </button>
      </div>

      <h1 className="text-2xl font-bold tracking-tight mb-1">
        {isCorrectionMode ? 'Resubmit Invoice' : 'Revise Invoice'}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {invoice.vendor.name} · #{invoice.invoiceNumber}
      </p>

      <form onSubmit={handleSubmit((v) => updateMutation.mutate(v))} className="space-y-5">
        {/* Optional new file */}
        <div className="space-y-1.5">
          <Label>Replace Invoice File (optional)</Label>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <FileText size={20} className="text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">{humanSize(file.size)}</p>
              </div>
              <button type="button" onClick={() => setFile(null)} className="p-1 rounded hover:bg-accent">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50',
              )}
            >
              <Upload size={20} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop new file here or <span className="text-primary font-medium">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">Leave empty to keep current file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>
          )}
          {fileError && <p className="text-xs text-destructive">{fileError}</p>}
        </div>

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceAmount">
              Invoice Amount (₹) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invoiceAmount"
              type="number"
              step="0.01"
              min="0.01"
              {...register('invoiceAmount')}
              className={cn(errors.invoiceAmount && 'border-destructive')}
            />
            {errors.invoiceAmount && (
              <p className="text-xs text-destructive">{errors.invoiceAmount.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoiceDate">Invoice Date</Label>
            <Input id="invoiceDate" type="date" {...register('invoiceDate')} />
          </div>
        </div>

        {/* Department — locked for role_1, dropdown for admin */}
        <div className="space-y-1.5">
          <Label htmlFor="departmentId">Department</Label>
          {isRole1 ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              <Lock size={13} className="shrink-0" />
              <span>{invoice.department?.name ?? '—'}</span>
            </div>
          ) : (
            <select
              id="departmentId"
              {...register('departmentId')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— No department —</option>
              {allDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Revision mode info */}
        {isRevisionMode && !!invoice && (
          amountChanged ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={13} className="shrink-0" />
              Price revision — submitting will mark this invoice as price revised
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
              <Info size={13} className="shrink-0" />
              No price change detected — will resubmit without marking as price revised
            </div>
          )
        )}

        {/* Change reason */}
        <div className="space-y-1.5">
          <Label htmlFor="changeReason">
            {isCorrectionMode ? 'Comments for reviewer' : 'Reason for revision'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="changeReason"
            {...register('changeReason')}
            placeholder={
              isSentBack
                ? 'Describe changes made in response to feedback…'
                : 'e.g. Corrected invoice amount after vendor confirmation'
            }
            className={cn(errors.changeReason && 'border-destructive')}
          />
          {errors.changeReason && (
            <p className="text-xs text-destructive">{errors.changeReason.message}</p>
          )}
        </div>

        {/* ── GRN Management (grn_bill only) ─────────────────────────────── */}
        {invoice.billType === 'grn_bill' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>GRN Entries</Label>
            </div>

            {/* Existing GRN rows */}
            {grnEntries.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">GRN Number</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="w-20 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {grnEntries.map((grn) => {
                      const isPaid = grn.status === 'paid'
                      const isReconciled = grn.status === 'reconciled'
                      const canEdit = grn.status === 'pending'
                      const isEditing = editingGrnId === grn.id

                      if (isEditing) {
                        const editDupOnOther =
                          editGrnDupResult?.isDuplicate &&
                          editGrnDupResult.existing?.invoiceId !== id &&
                          editGrnState.grnNumber.trim() !== grn.grnNumber

                        return (
                          <tr key={grn.id} className="bg-primary/5">
                            <td className="px-3 py-2">
                              <div className="space-y-0.5">
                                <Input
                                  value={editGrnState.grnNumber}
                                  onChange={(e) =>
                                    setEditGrnState((p) => ({ ...p, grnNumber: e.target.value }))
                                  }
                                  className="h-7 text-xs font-mono"
                                />
                                {editDupOnOther && (
                                  <p className="text-xs text-amber-600">
                                    Exists on invoice #{editGrnDupResult?.existing?.invoiceNumber}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="date"
                                value={editGrnState.grnDate}
                                onChange={(e) =>
                                  setEditGrnState((p) => ({ ...p, grnDate: e.target.value }))
                                }
                                className="h-7 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={editGrnState.grnAmount}
                                onChange={(e) =>
                                  setEditGrnState((p) => ({ ...p, grnAmount: e.target.value }))
                                }
                                className="h-7 text-xs text-right"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-xs text-muted-foreground capitalize">{grn.status}</span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => saveEditGrn(grn.id, grn.grnNumber)}
                                  disabled={updateGrnMutation.isPending}
                                  className="rounded p-1 text-primary hover:bg-accent"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditGrn}
                                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <Fragment key={grn.id}>
                          <tr className={cn((isPaid || (isReconciled && !isAdmin)) && 'opacity-75')}>
                            <td className="px-3 py-2 font-mono text-xs">{grn.grnNumber}</td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(grn.grnDate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fmtINR(parseFloat(grn.grnAmount))}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                {(isPaid || isReconciled) && (
                                  <Lock
                                    size={12}
                                    className="text-muted-foreground shrink-0"
                                    aria-label={isPaid ? 'Paid — cannot be modified' : 'Reconciled — cannot be modified'}
                                  />
                                )}
                                <span className="text-xs capitalize text-muted-foreground">{grn.status}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {canEdit ? (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => startEditGrn(grn)}
                                    title="Edit"
                                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteGrnMutation.mutate(grn.id)}
                                    disabled={deleteGrnMutation.isPending}
                                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ) : isReconciled && isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => setAdminOverrideGrnId(adminOverrideGrnId === grn.id ? null : grn.id)}
                                  title="Override edit (admin)"
                                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-amber-600"
                                >
                                  <Pencil size={13} />
                                </button>
                              ) : null}
                            </td>
                          </tr>
                          {adminOverrideGrnId === grn.id && (
                            <tr>
                              <td colSpan={5} className="px-3 pb-2 pt-0">
                                <div className="flex items-center gap-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs">
                                  <AlertTriangle size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                  <span className="flex-1 text-amber-800 dark:text-amber-300">
                                    Editing a reconciled GRN will require re-reconciliation. Are you sure?
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => { startEditGrn(grn); setAdminOverrideGrnId(null) }}
                                    className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700"
                                  >
                                    Proceed
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAdminOverrideGrnId(null)}
                                    className="rounded border border-input px-2 py-1 text-foreground hover:bg-accent"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                {editGrnError && (
                  <p className="px-3 py-2 text-xs text-destructive border-t">{editGrnError}</p>
                )}
              </div>
            )}

            {/* Add new GRN form */}
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <h2 className="text-sm font-medium">Add GRN Entry</h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    GRN Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={addForm.grnNumber}
                    onChange={(e) => setAddForm((p) => ({ ...p, grnNumber: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddGrn() } }}
                    placeholder="GRN-2024-001"
                    className="h-8 text-xs"
                  />
                  {addGrnCheckKey && addGrnDupResult?.isDuplicate && addGrnDupResult.existing?.invoiceId !== id && (
                    <p className="text-xs text-amber-600">
                      Already on #{addGrnDupResult.existing?.invoiceNumber} ({addGrnDupResult.existing?.vendorName})
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Amount (₹) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={addForm.grnAmount}
                    onChange={(e) => setAddForm((p) => ({ ...p, grnAmount: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddGrn() } }}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={addForm.grnDate}
                    onChange={(e) => setAddForm((p) => ({ ...p, grnDate: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              {addFormError && <p className="text-xs text-destructive">{addFormError}</p>}
              <Button
                type="button"
                size="sm"
                onClick={handleAddGrn}
                disabled={addGrnMutation.isPending}
              >
                <Plus size={14} />
                Add GRN
              </Button>
            </div>

            {/* Running total */}
            {grnEntries.length > 0 && (
              <div
                className={cn(
                  'space-y-1.5 rounded-lg border px-4 py-3 text-sm',
                  grnOverBudget ? 'border-destructive bg-destructive/5' : 'bg-muted/30',
                )}
              >
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice Amount</span>
                  <span className="tabular-nums">{fmtINR(invoiceAmountNum)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GRN Total</span>
                  <span className="tabular-nums font-medium">{fmtINR(grnTotal)}</span>
                </div>
                <div
                  className={cn(
                    'flex justify-between border-t pt-1.5 font-semibold',
                    grnOverBudget ? 'text-destructive' : '',
                  )}
                >
                  <span>Remaining</span>
                  <span className="tabular-nums">{fmtINR(grnRemaining)}</span>
                </div>
                {grnOverBudget && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle size={12} />
                    GRN total exceeds invoice amount — cannot submit
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/invoices/${id}`)}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={updateMutation.isPending || grnOverBudget}>
            {updateMutation.isPending
              ? 'Submitting…'
              : isCorrectionMode
                ? 'Resubmit for Review'
                : 'Submit Revision'}
          </Button>
        </div>
      </form>
    </div>
  )
}
