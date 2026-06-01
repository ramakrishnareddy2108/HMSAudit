import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Upload, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { type InvoiceStatus } from '@/components/invoices/InvoiceCard'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: invoice, isLoading, isError } = useQuery<InvoiceDetail>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  useEffect(() => {
    if (!invoice) return
    reset({
      invoiceDate: invoice.invoiceDate?.slice(0, 10) ?? '',
      invoiceAmount: invoice.invoiceAmount,
      departmentId: invoice.departmentId ?? '',
      changeReason: '',
    })
  }, [invoice, reset])

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

  // Guard: only role_1 / admin can edit; locked statuses are blocked
  const isLocked = invoice && ['reconciled', 'paid'].includes(invoice.status)

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-xl">
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

  const isSentBack = invoice.status === 'sent_back'

  return (
    <div className="max-w-xl">
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
        {isSentBack ? 'Resubmit Invoice' : 'Revise Invoice'}
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

        {/* Department */}
        {user?.departments && user.departments.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="departmentId">Department</Label>
            <select
              id="departmentId"
              {...register('departmentId')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— No department —</option>
              {user.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Change reason */}
        <div className="space-y-1.5">
          <Label htmlFor="changeReason">
            Reason for revision <span className="text-destructive">*</span>
          </Label>
          <Input
            id="changeReason"
            {...register('changeReason')}
            placeholder={isSentBack ? 'Describe changes made in response to feedback…' : 'e.g. Corrected invoice amount after vendor confirmation'}
            className={cn(errors.changeReason && 'border-destructive')}
          />
          {errors.changeReason && (
            <p className="text-xs text-destructive">{errors.changeReason.message}</p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/invoices/${id}`)}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending
              ? 'Submitting…'
              : isSentBack
                ? 'Resubmit for Review'
                : 'Submit Revision'}
          </Button>
        </div>
      </form>
    </div>
  )
}
