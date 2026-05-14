import { PrismaClient, PaymentMode } from '@prisma/client'

interface CreatePaymentInput {
  vendorId: string
  periodMonth: number
  periodYear: number
  grnIds: string[]
  paymentDate: Date
  paymentMode: PaymentMode
  transactionRef?: string
  remarks?: string
  createdBy: string
}

export class PaymentService {
  constructor(private prisma: PrismaClient) {}

  async createPayment(input: CreatePaymentInput) {
    // TODO: implement
    // 1. Validate all grnIds belong to vendor and are in reconciled status
    // 2. Calculate total amount
    // 3. Create Payment record + PaymentGrn join rows in a transaction
    // 4. Update GrnEntry statuses to 'paid'
    throw new Error('Not implemented')
  }

  async resendPaymentEmail(paymentId: string) {
    // TODO: implement
    throw new Error('Not implemented')
  }
}
