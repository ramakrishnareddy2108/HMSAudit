import { Resend } from 'resend'
import { config } from '../config'

interface PaymentEmailPayload {
  to: string
  vendorName: string
  paymentAmount: number
  paymentDate: string
  paymentMode: string
  transactionRef: string | null
  periodMonth: number
  periodYear: number
}

export class EmailService {
  private resend: Resend

  constructor() {
    this.resend = new Resend(config.resend.apiKey)
  }

  async sendPaymentConfirmation(payload: PaymentEmailPayload): Promise<void> {
    // TODO: implement with proper HTML template
    await this.resend.emails.send({
      from: 'invoices@yourhospital.com',
      to: payload.to,
      subject: `Payment Confirmation – ${payload.vendorName} – ${payload.periodMonth}/${payload.periodYear}`,
      html: `<p>Payment of ₹${payload.paymentAmount} processed on ${payload.paymentDate}.</p>`,
    })
  }
}

export const emailService = new EmailService()
