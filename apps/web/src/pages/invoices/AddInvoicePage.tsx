import { Fragment, useReducer, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Upload,
  FileText,
  X,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowLeft,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { ReviewSubmitStep } from '@/components/invoices/ReviewSubmitStep'
import type { WizardState, GrnRow } from '@/components/invoices/ReviewSubmitStep'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  name: string
  isActive: boolean
}

interface DuplicateResult {
  isDuplicate: boolean
  existing?: {
    id: string
    invoiceNumber: string
    status: string
    vendorName: string
    uploadedBy: string
    grnCount: number
  }
}

interface GrnCheckResult {
  isDuplicate: boolean
  existing?: {
    invoiceNumber: string
    vendorName: string
    uploadedBy: string
  }
}

// ── Wizard reducer ────────────────────────────────────────────────────────────

type Action =
  | { type: 'set_step1'; payload: Omit<WizardState, 'grns'> }
  | { type: 'add_grn'; grn: GrnRow }
  | { type: 'remove_grn'; key: string }

const INITIAL: WizardState = {
  file: null,
  vendorId: '',
  vendorName: '',
  invoiceNumber: '',
  invoiceDate: '',
  invoiceAmount: '',
  departmentId: '',
  departmentName: '',
  billType: 'grn_bill',
  miscCategory: '',
  miscDescription: '',
  grns: [],
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'set_step1':
      return { ...state, ...action.payload }
    case 'add_grn':
      return { ...state, grns: [...state.grns, action.grn] }
    case 'remove_grn':
      return { ...state, grns: state.grns.filter((g) => g.key !== action.key) }
    default:
      return state
  }
}

// ── Zod schema (Step 1) ───────────────────────────────────────────────────────

const formSchema = z
  .object({
    vendorId: z.string().min(1, 'Select a vendor'),
    invoiceNumber: z.string().min(1, 'Invoice number is required'),
    invoiceDate: z.string().optional(),
    invoiceAmount: z
      .string()
      .min(1, 'Amount is required')
      .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Enter a valid positive amount'),
    departmentId: z.string().optional(),
    billType: z.enum(['grn_bill', 'miscellaneous']),
    miscCategory: z.string().optional(),
    miscDescription: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billType === 'miscellaneous' && !data.miscCategory?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Category is required for miscellaneous bills',
        path: ['miscCategory'],
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

// ── Constants & helpers ───────────────────────────────────────────────────────

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtINR(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(n)) return '₹—'
  return '₹' + new Intl.NumberFormat('en-IN').format(n)
}

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM yyyy')
  } catch {
    return iso
  }
}

// ── Step indicator ────────────────────────────────────────────────────────────

const GRN_STEPS = [
  { n: 1 as const, label: 'Details' },
  { n: 2 as const, label: 'GRN Entries' },
  { n: 3 as const, label: 'Review' },
]
const MISC_STEPS = [
  { n: 1 as const, label: 'Details' },
  { n: 3 as const, label: 'Review' },
]

function StepIndicator({
  currentStep,
  billType,
}: {
  currentStep: 1 | 2 | 3
  billType: 'grn_bill' | 'miscellaneous'
}) {
  const steps = billType === 'grn_bill' ? GRN_STEPS : MISC_STEPS

  return (
    <div className="mb-8 flex items-start">
      {steps.map((s, i) => {
        const done = s.n < currentStep
        const active = s.n === currentStep
        return (
          <Fragment key={s.n}>
            {i > 0 && (
              <div
                className={cn(
                  'mt-4 h-px flex-1',
                  done || active ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium',
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : active
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30 text-muted-foreground',
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </div>
              <span
                className={cn(
                  'whitespace-nowrap text-xs',
                  active ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Page component ────────────────────────────────────────────────────────────

export default function AddInvoicePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  // Wizard
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [wiz, dispatch] = useReducer(reducer, INITIAL)

  // Step 1 — file
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 1 — duplicate check (debounced)
  const [dupCheckKey, setDupCheckKey] = useState<{
    vendorId: string
    invoiceNumber: string
  } | null>(null)

  // Step 2 — GRN add form
  const [grnForm, setGrnForm] = useState({ grnNumber: '', grnAmount: '', grnDate: '' })
  const [grnFormError, setGrnFormError] = useState('')
  const [grnCheckKey, setGrnCheckKey] = useState('')

  // ── React Hook Form (Step 1) ─────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vendorId: '',
      invoiceNumber: '',
      invoiceDate: '',
      invoiceAmount: '',
      departmentId: user?.departments?.[0]?.id ?? '',
      billType: 'grn_bill',
      miscCategory: '',
      miscDescription: '',
    },
  })

  const watchedVendorId = watch('vendorId')
  const watchedInvoiceNumber = watch('invoiceNumber')
  const watchedBillType = watch('billType')

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: vendorsData } = useQuery<{ data: Vendor[] }>({
    queryKey: ['vendors-active'],
    queryFn: () =>
      api.get('/vendors', { params: { isActive: true, limit: 200 } }).then((r) => r.data),
  })
  const vendors = vendorsData?.data ?? []

  const { data: dupResult } = useQuery<DuplicateResult>({
    queryKey: ['invoice-dup', dupCheckKey],
    queryFn: () =>
      api.get('/invoices/check-duplicate', { params: dupCheckKey! }).then((r) => r.data),
    enabled: dupCheckKey !== null,
    staleTime: 5_000,
  })

  const { data: grnDupResult } = useQuery<GrnCheckResult>({
    queryKey: ['grn-check', grnCheckKey],
    queryFn: () =>
      api.get('/grns/check', { params: { grnNumber: grnCheckKey } }).then((r) => r.data),
    enabled: !!grnCheckKey && step === 2,
    staleTime: 5_000,
    retry: false,
  })

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!watchedVendorId || !watchedInvoiceNumber?.trim()) {
      setDupCheckKey(null)
      return
    }
    const id = setTimeout(
      () =>
        setDupCheckKey({
          vendorId: watchedVendorId,
          invoiceNumber: watchedInvoiceNumber.trim(),
        }),
      600,
    )
    return () => clearTimeout(id)
  }, [watchedVendorId, watchedInvoiceNumber])

  useEffect(() => {
    if (!grnForm.grnNumber.trim()) {
      setGrnCheckKey('')
      return
    }
    const id = setTimeout(() => setGrnCheckKey(grnForm.grnNumber.trim()), 600)
    return () => clearTimeout(id)
  }, [grnForm.grnNumber])

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

  // ── Step 1 submit ────────────────────────────────────────────────────────

  function onStep1Submit(values: FormValues) {
    if (!file) {
      setFileError('Please attach an invoice file.')
      return
    }
    const vendor = vendors.find((v) => v.id === values.vendorId)
    const dept = user?.departments?.find((d) => d.id === values.departmentId)
    dispatch({
      type: 'set_step1',
      payload: {
        file,
        vendorId: values.vendorId,
        vendorName: vendor?.name ?? '',
        invoiceNumber: values.invoiceNumber.trim(),
        invoiceDate: values.invoiceDate ?? '',
        invoiceAmount: values.invoiceAmount,
        departmentId: values.departmentId ?? '',
        departmentName: dept?.name ?? '',
        billType: values.billType,
        miscCategory: values.miscCategory ?? '',
        miscDescription: values.miscDescription ?? '',
      },
    })
    setStep(values.billType === 'miscellaneous' ? 3 : 2)
  }

  // ── GRN handlers ─────────────────────────────────────────────────────────

  function handleAddGrn() {
    const { grnNumber, grnAmount } = grnForm
    if (!grnNumber.trim()) {
      setGrnFormError('GRN number is required.')
      return
    }
    const amount = parseFloat(grnAmount)
    if (!grnAmount || isNaN(amount) || amount <= 0) {
      setGrnFormError('Enter a valid positive amount.')
      return
    }
    if (wiz.grns.some((g) => g.grnNumber.toLowerCase() === grnNumber.trim().toLowerCase())) {
      setGrnFormError('This GRN number is already added.')
      return
    }
    dispatch({
      type: 'add_grn',
      grn: {
        key: Math.random().toString(36).slice(2),
        grnNumber: grnNumber.trim(),
        grnAmount,
        grnDate: grnForm.grnDate,
      },
    })
    setGrnForm({ grnNumber: '', grnAmount: '', grnDate: '' })
    setGrnFormError('')
    setGrnCheckKey('')
  }

  // ── Derived values ───────────────────────────────────────────────────────

  const isDuplicate = dupResult?.isDuplicate === true
  const grnTotal = wiz.grns.reduce((s, g) => s + parseFloat(g.grnAmount || '0'), 0)
  const invoiceAmountNum = parseFloat(wiz.invoiceAmount || '0')
  const grnRemaining = invoiceAmountNum - grnTotal
  const grnOverBudget = grnTotal > invoiceAmountNum + 0.001
  const indicatorBillType = step === 1 ? watchedBillType : wiz.billType

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">New Invoice</h1>
      </div>

      <StepIndicator currentStep={step} billType={indicatorBillType} />

      {/* ── Step 1: Invoice details ────────────────────────────────────────── */}
      {step === 1 && (
        <form onSubmit={handleSubmit(onStep1Submit)} className="space-y-5">
          {/* File drop zone */}
          <div className="space-y-1.5">
            <Label>
              Invoice File <span className="text-destructive">*</span>
            </Label>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                <FileText size={20} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{humanSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="rounded p-1 hover:bg-accent"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50',
                )}
              >
                <Upload size={24} className="text-muted-foreground" />
                <p className="text-center text-sm text-muted-foreground">
                  Drop file here or{' '}
                  <span className="font-medium text-primary">browse</span>
                </p>
                <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or PDF · max 10 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </div>
            )}
            {fileError && <p className="text-xs text-destructive">{fileError}</p>}
          </div>

          {/* Vendor */}
          <div className="space-y-1.5">
            <Label htmlFor="vendorId">
              Vendor <span className="text-destructive">*</span>
            </Label>
            <select
              id="vendorId"
              {...register('vendorId')}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring',
                errors.vendorId && 'border-destructive',
              )}
            >
              <option value="">— Select vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {errors.vendorId && (
              <p className="text-xs text-destructive">{errors.vendorId.message}</p>
            )}
          </div>

          {/* Invoice number + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoiceNumber">
                Invoice Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="invoiceNumber"
                {...register('invoiceNumber')}
                placeholder="INV-2024-001"
                className={cn(errors.invoiceNumber && 'border-destructive')}
              />
              {errors.invoiceNumber && (
                <p className="text-xs text-destructive">{errors.invoiceNumber.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoiceDate">Invoice Date</Label>
              <Input id="invoiceDate" type="date" {...register('invoiceDate')} />
            </div>
          </div>

          {/* Duplicate warning */}
          {isDuplicate && dupResult?.existing && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">Possible duplicate</p>
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                  Invoice <strong>{dupResult.existing.invoiceNumber}</strong> already exists from{' '}
                  <strong>{dupResult.existing.vendorName}</strong> — status:{' '}
                  <strong>{dupResult.existing.status}</strong>.
                </p>
                <button
                  type="button"
                  className="mt-1 text-xs text-amber-600 underline dark:text-amber-400"
                  onClick={() => navigate(`/invoices/${dupResult.existing!.id}`)}
                >
                  View existing invoice →
                </button>
              </div>
            </div>
          )}

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="invoiceAmount">
              Invoice Amount (₹) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invoiceAmount"
              {...register('invoiceAmount')}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              className={cn(errors.invoiceAmount && 'border-destructive')}
            />
            {errors.invoiceAmount && (
              <p className="text-xs text-destructive">{errors.invoiceAmount.message}</p>
            )}
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

          {/* Bill type */}
          <div className="space-y-1.5">
            <Label>
              Bill Type <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-3">
              {(
                [
                  ['grn_bill', 'GRN Bill'],
                  ['miscellaneous', 'Miscellaneous'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors',
                    watchedBillType === value
                      ? 'border-primary bg-primary/5 font-medium text-primary'
                      : 'border-input hover:bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    value={value}
                    {...register('billType')}
                    className="sr-only"
                  />
                  {watchedBillType === value ? (
                    <CheckCircle2 size={15} className="shrink-0" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground" />
                  )}
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Misc fields */}
          {watchedBillType === 'miscellaneous' && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="miscCategory">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="miscCategory"
                  {...register('miscCategory')}
                  placeholder="e.g. Stationery, Repairs, Utilities…"
                  className={cn(errors.miscCategory && 'border-destructive')}
                />
                {errors.miscCategory && (
                  <p className="text-xs text-destructive">{errors.miscCategory.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="miscDescription">Description (optional)</Label>
                <Input
                  id="miscDescription"
                  {...register('miscDescription')}
                  placeholder="Brief description of the expense"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/invoices')}
            >
              Cancel
            </Button>
            <Button type="submit">Next</Button>
          </div>
        </form>
      )}

      {/* ── Step 2: GRN entries ────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Invoice summary bar */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <span className="font-medium">{wiz.invoiceNumber}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span>{wiz.vendorName}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="font-semibold">{fmtINR(wiz.invoiceAmount)}</span>
          </div>

          {/* Add GRN form */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <h2 className="text-sm font-medium">Add GRN Entry</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>
                  GRN Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={grnForm.grnNumber}
                  onChange={(e) =>
                    setGrnForm((p) => ({ ...p, grnNumber: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddGrn()
                    }
                  }}
                  placeholder="GRN-2024-001"
                />
                {grnCheckKey && grnDupResult?.isDuplicate && grnDupResult.existing && (
                  <p className="text-xs text-amber-600">
                    Already on invoice #{grnDupResult.existing.invoiceNumber} (
                    {grnDupResult.existing.vendorName})
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Amount (₹) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={grnForm.grnAmount}
                  onChange={(e) =>
                    setGrnForm((p) => ({ ...p, grnAmount: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddGrn()
                    }
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={grnForm.grnDate}
                  onChange={(e) =>
                    setGrnForm((p) => ({ ...p, grnDate: e.target.value }))
                  }
                />
              </div>
            </div>
            {grnFormError && <p className="text-xs text-destructive">{grnFormError}</p>}
            <Button type="button" size="sm" onClick={handleAddGrn}>
              <Plus size={14} />
              Add GRN
            </Button>
          </div>

          {/* GRN list */}
          {wiz.grns.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">GRN Number</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="w-10 px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {wiz.grns.map((g) => (
                    <tr key={g.key}>
                      <td className="px-4 py-2 font-mono text-xs">{g.grnNumber}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {g.grnDate ? fmtDate(g.grnDate) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtINR(g.grnAmount)}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'remove_grn', key: g.key })}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No GRN entries yet. Add GRNs above or proceed to review without them.
            </p>
          )}

          {/* Running total */}
          {wiz.grns.length > 0 && (
            <div
              className={cn(
                'space-y-1.5 rounded-lg border px-4 py-3 text-sm',
                grnOverBudget ? 'border-destructive bg-destructive/5' : 'bg-muted/30',
              )}
            >
              <div className="flex justify-between">
                <span className="text-muted-foreground">GRN Total</span>
                <span className="tabular-nums font-medium">{fmtINR(grnTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Amount</span>
                <span className="tabular-nums">{fmtINR(invoiceAmountNum)}</span>
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
                <p className="text-xs text-destructive">GRN total exceeds invoice amount.</p>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" type="button" onClick={() => setStep(1)}>
              <ArrowLeft size={16} />
              Back
            </Button>
            <Button type="button" onClick={() => setStep(3)} disabled={grnOverBudget}>
              Next: Review
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review & Submit ────────────────────────────────────────── */}
      {step === 3 && (
        <ReviewSubmitStep
          state={wiz}
          onBack={() => setStep(wiz.billType === 'grn_bill' ? 2 : 1)}
        />
      )}
    </div>
  )
}
