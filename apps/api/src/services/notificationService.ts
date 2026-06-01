import type { PrismaClient } from '@prisma/client'
import { Role } from '@prisma/client'

interface CreateInput {
  title: string
  message: string
  type: string
  entityType?: string
  entityId?: string
}

export async function create(
  prisma: PrismaClient,
  userId: string,
  data: CreateInput,
) {
  return prisma.notification.create({
    data: {
      userId,
      title: data.title,
      message: data.message,
      type: data.type,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
    },
  })
}

export async function notifyInvoiceSentBack(
  prisma: PrismaClient,
  invoiceId: string,
  uploaderId: string,
  note: string,
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: { select: { name: true } } },
  })
  if (!invoice) return

  await create(prisma, uploaderId, {
    title: 'Invoice Sent Back',
    message: `Invoice ${invoice.invoiceNumber} from ${invoice.vendor.name} has been sent back. Reason: ${note}`,
    type: 'invoice_sent_back',
    entityType: 'invoice',
    entityId: invoiceId,
  })
}

export async function notifyInvoiceApproved(
  prisma: PrismaClient,
  invoiceId: string,
  uploaderId: string,
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: { select: { name: true } } },
  })
  if (!invoice) return

  await create(prisma, uploaderId, {
    title: 'Invoice Approved',
    message: `Invoice ${invoice.invoiceNumber} from ${invoice.vendor.name} has been approved.`,
    type: 'invoice_approved',
    entityType: 'invoice',
    entityId: invoiceId,
  })
}

export async function notifyNewReviewItem(
  prisma: PrismaClient,
  invoiceId: string,
) {
  const [invoice, reviewers] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { vendor: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { role: { in: [Role.role_2, Role.admin] }, isActive: true },
      select: { id: true },
    }),
  ])

  if (!invoice || reviewers.length === 0) return

  await prisma.notification.createMany({
    data: reviewers.map((r) => ({
      userId: r.id,
      title: 'New Invoice for Review',
      message: `Invoice ${invoice.invoiceNumber} from ${invoice.vendor.name} is ready for review.`,
      type: 'new_review_item',
      entityType: 'invoice',
      entityId: invoiceId,
    })),
  })
}
