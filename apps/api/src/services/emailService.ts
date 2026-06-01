import { Resend } from 'resend'
import { config } from '../config'

interface GrnItem {
  grnNumber: string
  invoiceNumber: string
  amount: number
}

export interface PaymentEmailParams {
  vendorEmail: string
  vendorName: string
  paymentAmount: number
  paymentDate: string
  paymentMode: string
  transactionRef: string | null
  remarks?: string
  grns: GrnItem[]
  customBody?: string
}

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

function buildEmailHtml(params: PaymentEmailParams): string {
  const { vendorName, paymentAmount, paymentDate, paymentMode, transactionRef, remarks, grns, customBody } = params

  const defaultBody = [
    `Dear ${vendorName},`,
    '',
    `Payment of ${formatCurrency(paymentAmount)} confirmed on ${formatDate(paymentDate)} via ${paymentMode.toUpperCase()}.`,
    transactionRef ? `Reference: ${transactionRef}.` : null,
    remarks ? `Remarks: ${remarks}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')

  const bodyHtml = (customBody ?? defaultBody).replace(/\n/g, '<br>')

  const grnRows = grns
    .map(
      (g) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${g.grnNumber}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${g.invoiceNumber}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(g.amount)}</td>
        </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#1f2937;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1d4ed8;border-bottom:2px solid #1d4ed8;padding-bottom:8px;">Payment Confirmation</h2>
  <p style="line-height:1.6;">${bodyHtml}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">GRN Number</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Invoice Number</th>
        <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb;">Amount</th>
      </tr>
    </thead>
    <tbody>${grnRows}</tbody>
    <tfoot>
      <tr style="font-weight:bold;background:#f3f4f6;">
        <td colspan="2" style="padding:8px 12px;border-top:2px solid #e5e7eb;">Total</td>
        <td style="padding:8px 12px;text-align:right;border-top:2px solid #e5e7eb;">${formatCurrency(paymentAmount)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="margin-top:24px;color:#6b7280;font-size:14px;">Regards,<br><strong>Hospital Billing Team</strong></p>
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
      subject: `Payment Confirmation – ${params.vendorName} – ${formatCurrency(params.paymentAmount)}`,
      html,
    })
  }

  generateEmailPreview(params: PaymentEmailParams): string {
    return buildEmailHtml(params)
  }
}

export const emailService = new EmailService()
