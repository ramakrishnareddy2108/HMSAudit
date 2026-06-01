import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { AlertCircle, ArrowLeft, FileText, Loader2, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Shared types (imported by AddInvoicePage) ──────────────────────────────────

export interface GrnRow {
  key: string
  grnNumber: string
  grnAmount: string
  grnDate: string
}

export interface WizardState {
  file: File | null
  vendorId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: string
  departmentId: string
  departmentName: string
  billType: 'grn_bill' | 'miscellaneous'
  miscCategory: string
  miscDescription: string
  grns: GrnRow[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  state: WizardState
  onBack: () => void
}

export function ReviewSubmitStep({ state, onBack }: Props) {
  const navigate = useNavigate()
  const [imgOpen, setImgOpen] = useState(false)
  const [objUrl, setObjUrl] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!state.file) return
    const url = URL.createObjectURL(state.file)
    setObjUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [state.file])

  const isImage = !!state.file?.type.startsWith('image/')

  const invoiceAmount = parseFloat(state.invoiceAmount || '0')
  const grnTotal = state.grns.reduce((s, g) => s + parseFloat(g.grnAmount || '0'), 0)
  const remaining = invoiceAmount - grnTotal
  const overBudget = grnTotal > invoiceAmount + 0.001

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!state.file) throw new Error('File missing')

      const fd = new FormData()
      fd.append('file', state.file)

      const meta: Record<string, unknown> = {
        vendorId: state.vendorId,
        invoiceNumber: state.invoiceNumber.trim(),
        invoiceAmount: parseFloat(state.invoiceAmount),
        billType: state.billType,
      }
      if (state.invoiceDate) meta.invoiceDate = state.invoiceDate
      if (state.departmentId) meta.departmentId = state.departmentId
      if (state.billType === 'miscellaneous') {
        if (state.miscCategory.trim()) meta.miscCategory = state.miscCategory.trim()
        if (state.miscDescription.trim()) meta.miscDescription = state.miscDescription.trim()
      }
      fd.append('data', JSON.stringify(meta))

      const { id } = await api
        .post('/invoices', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        .then((r) => r.data as { id: string })

      if (state.billType === 'grn_bill' && state.grns.length > 0) {
        await Promise.all(
          state.grns.map((g) =>
            api.post(`/invoices/${id}/grns`, {
              grnNumber: g.grnNumber.trim(),
              grnAmount: parseFloat(g.grnAmount),
              ...(g.grnDate ? { grnDate: g.grnDate } : {}),
            }),
          ),
        )
      }

      return id
    },
    onSuccess: (id) => {
      toast.success('Invoice submitted — OCR processing started')
      navigate(`/invoices/${id}`)
    },
    onError: (err: unknown) => {
      type E = { response?: { data?: { error?: string; existing?: { id: string } } } }
      const e = err as E
      if (e.response?.data?.error === 'DUPLICATE_INVOICE' && e.response.data.existing?.id) {
        toast.error('Duplicate invoice — redirecting to existing record')
        navigate(`/invoices/${e.response.data.existing.id}`)
        return
      }
      setSubmitError(e.response?.data?.error ?? 'Upload failed. Please try again.')
    },
  })

  return (
    <div className="space-y-6">
      {/* File thumbnail */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Invoice File</h2>
        {objUrl && isImage ? (
          <button
            type="button"
            onClick={() => setImgOpen(true)}
            className="group relative h-32 w-32 overflow-hidden rounded-lg border bg-muted transition hover:ring-2 hover:ring-primary"
          >
            <img src={objUrl} alt="thumbnail" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
              <ZoomIn size={20} className="text-white" />
            </div>
          </button>
        ) : (
          <div className="flex w-fit items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <FileText size={20} className="text-muted-foreground" />
            <span className="text-sm font-medium">{state.file?.name ?? '—'}</span>
          </div>
        )}
      </section>

      {/* Invoice fields */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Invoice Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Vendor" value={state.vendorName || '—'} />
          <Field label="Invoice #" value={state.invoiceNumber || '—'} />
          <Field label="Date" value={state.invoiceDate ? fmtDate(state.invoiceDate) : '—'} />
          <Field label="Amount" value={fmtINR(state.invoiceAmount)} bold />
          {state.departmentName && <Field label="Department" value={state.departmentName} />}
          <Field
            label="Bill Type"
            value={state.billType === 'grn_bill' ? 'GRN Bill' : 'Miscellaneous'}
          />
          {state.billType === 'miscellaneous' && state.miscCategory && (
            <Field label="Category" value={state.miscCategory} />
          )}
          {state.billType === 'miscellaneous' && state.miscDescription && (
            <Field label="Description" value={state.miscDescription} span />
          )}
        </dl>
      </section>

      {/* GRN section */}
      {state.billType === 'grn_bill' && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            GRN Entries
            {state.grns.length > 0 && (
              <span className="ml-1.5 text-xs font-normal">({state.grns.length})</span>
            )}
          </h2>

          {state.grns.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No GRN entries — invoice will be submitted without GRNs.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">GRN Number</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {state.grns.map((g) => (
                    <tr key={g.key}>
                      <td className="px-4 py-2 font-mono text-xs">{g.grnNumber}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {g.grnDate ? fmtDate(g.grnDate) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtINR(g.grnAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {state.grns.length > 0 && (
            <div
              className={cn(
                'mt-3 space-y-1.5 rounded-lg border px-4 py-3 text-sm',
                overBudget ? 'border-destructive bg-destructive/5' : 'bg-muted/30',
              )}
            >
              <div className="flex justify-between">
                <span className="text-muted-foreground">GRN Total</span>
                <span className="tabular-nums font-medium">{fmtINR(grnTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Amount</span>
                <span className="tabular-nums">{fmtINR(invoiceAmount)}</span>
              </div>
              <div
                className={cn(
                  'flex justify-between border-t pt-1.5 font-semibold',
                  overBudget ? 'text-destructive' : '',
                )}
              >
                <span>Remaining</span>
                <span className="tabular-nums">{fmtINR(remaining)}</span>
              </div>
              {overBudget && (
                <p className="text-xs text-destructive">
                  GRN total exceeds invoice amount. Go back and remove entries.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Error banner */}
      {submitError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={16} className="shrink-0" />
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          type="button"
          onClick={onBack}
          disabled={submitMutation.isPending}
        >
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button
          type="button"
          onClick={() => {
            setSubmitError(null)
            submitMutation.mutate()
          }}
          disabled={submitMutation.isPending || overBudget}
        >
          {submitMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Uploading invoice…
            </>
          ) : (
            'Submit Invoice'
          )}
        </Button>
      </div>

      {/* Full-size lightbox */}
      <Dialog open={imgOpen} onOpenChange={setImgOpen}>
        <DialogContent className="max-w-5xl p-2">
          <DialogTitle className="sr-only">Invoice preview</DialogTitle>
          {objUrl && (
            <img
              src={objUrl}
              alt="Invoice full size"
              className="max-h-[85vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  bold,
  span,
}: {
  label: string
  value: string
  bold?: boolean
  span?: boolean
}) {
  return (
    <div className={cn('space-y-0.5', span && 'col-span-2 sm:col-span-3')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', bold && 'font-semibold')}>{value}</dd>
    </div>
  )
}
