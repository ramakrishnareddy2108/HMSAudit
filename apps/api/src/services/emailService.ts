import { Resend } from 'resend'
import { config } from '../config'

interface GrnItem {
  grnNumber: string
  grnDate: string | null
  invoiceNumber: string
  invoiceDate: string | null
  amount: number
}

export interface PaymentEmailParams {
  vendorEmail: string
  vendorName: string
  hospitalName: string
  paymentAmount: number
  paymentDate: string
  paymentMode: string
  transactionRef: string | null
  remarks?: string
  grns: GrnItem[]
  outstandingAfter: number
  customBody?: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function cell(content: string, extra = ''): string {
  return `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;${extra}">${content}</td>`
}

function buildEmailHtml(params: PaymentEmailParams): string {
  const {
    vendorName, hospitalName, paymentAmount, paymentDate, paymentMode,
    transactionRef, remarks, grns, outstandingAfter, customBody,
  } = params

  // Group GRNs by invoice number
  const invoiceMap = new Map<string, {
    invoiceNumber: string
    invoiceDate: string | null
    grns: GrnItem[]
    subtotal: number
  }>()
  for (const grn of grns) {
    if (!invoiceMap.has(grn.invoiceNumber)) {
      invoiceMap.set(grn.invoiceNumber, {
        invoiceNumber: grn.invoiceNumber,
        invoiceDate: grn.invoiceDate,
        grns: [],
        subtotal: 0,
      })
    }
    const inv = invoiceMap.get(grn.invoiceNumber)!
    inv.grns.push(grn)
    inv.subtotal += grn.amount
  }

  const th = (text: string, align = 'left'): string =>
    `<th style="padding:8px 12px;text-align:${align};border-bottom:2px solid #e5e7eb;color:#374151;font-size:13px;">${text}</th>`

  const invoiceSections = Array.from(invoiceMap.values())
    .map(
      (inv) => `
      <div style="margin-bottom:20px;">
        <p style="font-weight:600;margin:0 0 8px 0;color:#1f2937;font-size:14px;">
          Invoice ${inv.invoiceNumber}${inv.invoiceDate ? ` dated ${formatDate(inv.invoiceDate)}` : ''}
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              ${th('GRN Number')}${th('Date')}${th('Amount', 'right')}
            </tr>
          </thead>
          <tbody>
            ${inv.grns
              .map(
                (g) => `<tr>
                ${cell(g.grnNumber)}
                ${cell(g.grnDate ? formatDate(g.grnDate) : '—')}
                ${cell(formatCurrency(g.amount), 'text-align:right;')}
              </tr>`,
              )
              .join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f3f4f6;">
              <td colspan="2" style="padding:8px 12px;font-weight:600;color:#374151;">Invoice Subtotal</td>
              <td style="padding:8px 12px;text-align:right;font-weight:600;color:#374151;">${formatCurrency(inv.subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`,
    )
    .join('')

  const remarksRow = remarks
    ? `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:160px;">Remarks</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${remarks}</td>
      </tr>`
    : ''

  const customNote = customBody
    ? `<p style="margin:0 0 20px 0;line-height:1.6;color:#374151;">${customBody.replace(/\n/g, '<br>')}</p>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#1f2937;max-width:680px;margin:0 auto;padding:24px;background:#ffffff;">

  <h2 style="color:#1d4ed8;border-bottom:2px solid #1d4ed8;padding-bottom:8px;margin-bottom:20px;">
    Payment Confirmation
  </h2>

  <table style="width:100%;margin-bottom:20px;border-collapse:collapse;">
    <tr>
      <td style="padding:4px 0;color:#6b7280;width:160px;">Hospital</td>
      <td style="padding:4px 0;font-weight:600;">${hospitalName}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280;">Payment Date</td>
      <td style="padding:4px 0;">${formatDate(paymentDate)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280;">Vendor</td>
      <td style="padding:4px 0;">${vendorName}</td>
    </tr>
  </table>

  ${customNote}

  <h3 style="color:#374151;margin:0 0 12px 0;font-size:15px;">Payment Details</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:160px;">Amount</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:15px;">${formatCurrency(paymentAmount)}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Payment Mode</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${paymentMode.toUpperCase()}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;${remarks ? 'border-bottom:1px solid #e5e7eb;' : ''}color:#6b7280;">Reference</td>
      <td style="padding:8px 12px;${remarks ? 'border-bottom:1px solid #e5e7eb;' : ''}">${transactionRef ?? '—'}</td>
    </tr>
    ${remarksRow}
  </table>

  <h3 style="color:#374151;margin:0 0 16px 0;font-size:15px;">GRN Details</h3>
  ${invoiceSections}

  <table style="width:100%;border-collapse:collapse;margin-top:8px;border:2px solid #1d4ed8;border-radius:6px;overflow:hidden;">
    <tr style="background:#1d4ed8;">
      <td style="padding:10px 12px;color:#fff;font-weight:600;">Total Payment</td>
      <td style="padding:10px 12px;color:#fff;font-weight:700;text-align:right;">${formatCurrency(paymentAmount)}</td>
    </tr>
    <tr style="background:#eff6ff;">
      <td style="padding:10px 12px;color:#374151;">Outstanding after this payment</td>
      <td style="padding:10px 12px;color:#374151;font-weight:600;text-align:right;">${formatCurrency(outstandingAfter)}</td>
    </tr>
  </table>

  <p style="margin-top:32px;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;padding-top:16px;">
    Regards,<br><strong style="color:#374151;">Hospital Billing Team</strong>
  </p>
</body>
</html>`
}

export class EmailService {
  private resend: Resend
  private from: string

  constructor() {
    this.resend = new Resend(config.resend.apiKey)
    this.from = process.env.RESEND_FROM ?? 'HMS Payments <onboarding@resend.dev>'
  }

  async sendPaymentEmail(params: PaymentEmailParams): Promise<void> {
    const html = buildEmailHtml(params)
    await this.resend.emails.send({
      from: this.from,
      to: params.vendorEmail,
      subject: `Payment Confirmation — ${params.vendorName} — ${formatCurrency(params.paymentAmount)}`,
      html,
    })
  }

  generateEmailPreview(params: PaymentEmailParams): string {
    return buildEmailHtml(params)
  }
}

export const emailService = new EmailService()

export { MONTHS }
