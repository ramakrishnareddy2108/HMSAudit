import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { emailService } from '../services/emailService'
import { MONTHS } from '../services/emailService'
import { AUDIT_LOG_ENABLED } from '../constants'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const eligibleGrnsQuerySchema = z.object({
  vendorId: z.string().uuid(),
  includeDisputed: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
})

const calculateAllocationBodySchema = z.object({
  vendorId: z.string().uuid(),
  grnIds: z.array(z.string().uuid()).min(1),
  paymentAmount: z.number().positive(),
})

const createPaymentBodySchema = z.object({
  vendorId: z.string().uuid(),
  grnIds: z.array(z.string().uuid()).min(1),
  includeDisputedIds: z.array(z.string().uuid()).optional(),
  paymentDate: z.string(),
  paymentMode: z.enum(['neft', 'rtgs', 'cheque', 'cash']),
  transactionRef: z.string().optional(),
  remarks: z.string().optional(),
  emailBody: z.string().optional(),
  sendEmail: z.boolean().default(true),
  grnAllocations: z
    .array(
      z.object({
        grnId: z.string().uuid(),
        amountPaid: z.number().positive(),
        isPartial: z.boolean(),
      }),
    )
    .optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vendorId: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).optional(),
})

const resendEmailBodySchema = z.object({
  emailBody: z.string().optional(),
})

type EligibleGrn = {
  id: string
  grnNumber: string
  grnAmount: Prisma.Decimal
  paidAmount: Prisma.Decimal
  grnDate: Date | null
  invoiceId: string
  invoice: {
    invoiceNumber: string
    invoiceDate: Date | null
    invoiceAmount: Prisma.Decimal
  }
}

function groupByInvoiceMonth(grns: EligibleGrn[]) {
  const monthMap = new Map<
    string,
    {
      month: number
      year: number
      label: string
      grns: Array<{
        id: string
        grnNumber: string
        grnAmount: number
        paidAmount: number
        remainingAmount: number
        isPartiallyPaid: boolean
        grnDate: string | null
        invoiceId: string
        invoice: { invoiceNumber: string; invoiceDate: string | null; invoiceAmount: number }
      }>
      groupTotal: number
    }
  >()

  for (const grn of grns) {
    const date = grn.invoice.invoiceDate ?? new Date()
    const month = date.getMonth() + 1
    const year = date.getFullYear()
    const key = `${year}-${String(month).padStart(2, '0')}`

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month,
        year,
        label: `${MONTHS[month - 1]} ${year}`,
        grns: [],
        groupTotal: 0,
      })
    }

    const group = monthMap.get(key)!
    const grnAmount = Number(grn.grnAmount)
    const paidAmount = Number(grn.paidAmount)
    const remainingAmount = grnAmount - paidAmount
    const isPartiallyPaid = paidAmount > 0 && paidAmount < grnAmount

    group.grns.push({
      id: grn.id,
      grnNumber: grn.grnNumber,
      grnAmount,
      paidAmount,
      remainingAmount,
      isPartiallyPaid,
      grnDate: grn.grnDate ? grn.grnDate.toISOString().slice(0, 10) : null,
      invoiceId: grn.invoiceId,
      invoice: {
        invoiceNumber: grn.invoice.invoiceNumber,
        invoiceDate: grn.invoice.invoiceDate
          ? grn.invoice.invoiceDate.toISOString().slice(0, 10)
          : null,
        invoiceAmount: Number(grn.invoice.invoiceAmount),
      },
    })
    group.groupTotal += remainingAmount
  }

  // Sort GRNs within each group by grnDate ascending (FIFO)
  for (const group of monthMap.values()) {
    group.grns.sort((a, b) => {
      if (!a.grnDate && !b.grnDate) return 0
      if (!a.grnDate) return 1
      if (!b.grnDate) return -1
      return a.grnDate < b.grnDate ? -1 : a.grnDate > b.grnDate ? 1 : 0
    })
  }

  return Array.from(monthMap.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  )
}

const eligibleGrnSelect = {
  id: true,
  grnNumber: true,
  grnAmount: true,
  paidAmount: true,
  grnDate: true,
  invoiceId: true,
  invoice: {
    select: {
      invoiceNumber: true,
      invoiceDate: true,
      invoiceAmount: true,
    },
  },
} as const

const eligibleBaseWhere = (vendorId: string): Prisma.GrnEntryWhereInput => ({
  isDeleted: false,
  invoice: {
    vendorId,
    isDeleted: false,
    status: { in: ['approved', 'reconciled'] },
  },
})

async function remainingOutstanding(
  prisma: FastifyRequest['server']['prisma'],
  vendorId: string,
): Promise<number> {
  const grns = await prisma.grnEntry.findMany({
    where: {
      isDeleted: false,
      status: { in: ['reconciled', 'partial_paid'] },
      invoice: {
        vendorId,
        isDeleted: false,
        status: { in: ['approved', 'reconciled'] },
      },
    },
    select: { grnAmount: true, paidAmount: true },
  })
  return grns.reduce((sum, g) => sum + Number(g.grnAmount) - Number(g.paidAmount), 0)
}

export default async function paymentsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/eligible-grns',
    {
      schema: { tags: ['Payments'], summary: 'List eligible GRNs for payment grouped by invoice month' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { vendorId, includeDisputed } = eligibleGrnsQuerySchema.parse(request.query)
      const prisma = request.server.prisma

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, name: true, email: true, contactName: true },
      })
      if (!vendor) return reply.code(404).send({ error: 'Vendor not found' })

      const baseWhere = eligibleBaseWhere(vendorId)

      const eligibleGrns = (await prisma.grnEntry.findMany({
        where: {
          ...baseWhere,
          status: { in: ['reconciled', 'partial_paid'] },
        },
        select: eligibleGrnSelect,
        orderBy: [{ grnDate: 'asc' }],
      })) as EligibleGrn[]

      const monthlyGroups = groupByInvoiceMonth(eligibleGrns)
      const totalOutstanding = eligibleGrns.reduce(
        (sum, g) => sum + Number(g.grnAmount) - Number(g.paidAmount),
        0,
      )

      const response: Record<string, unknown> = { vendor, monthlyGroups, totalOutstanding }

      if (includeDisputed) {
        const disputedGrns = (await prisma.grnEntry.findMany({
          where: { ...baseWhere, status: 'disputed' },
          select: eligibleGrnSelect,
          orderBy: [{ grnDate: 'asc' }],
        })) as EligibleGrn[]

        response.disputedGroups = groupByInvoiceMonth(disputedGrns)
        response.totalDisputedAmount = disputedGrns.reduce(
          (sum, g) => sum + Number(g.grnAmount) - Number(g.paidAmount),
          0,
        )
      }

      return response
    },
  )

  fastify.post(
    '/calculate-allocation',
    {
      schema: { tags: ['Payments'], summary: 'Calculate partial payment allocation across GRNs' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { vendorId, grnIds, paymentAmount } = calculateAllocationBodySchema.parse(request.body)
      const prisma = request.server.prisma

      const grns = await prisma.grnEntry.findMany({
        where: { id: { in: grnIds }, isDeleted: false },
        select: {
          id: true,
          grnNumber: true,
          grnAmount: true,
          paidAmount: true,
          grnDate: true,
          invoice: { select: { invoiceNumber: true, vendorId: true } },
        },
      })

      if (grns.length !== grnIds.length) {
        return reply.code(404).send({ error: 'One or more GRN entries not found' })
      }

      const wrongVendor = grns.filter((g) => g.invoice.vendorId !== vendorId)
      if (wrongVendor.length > 0) {
        return reply.code(422).send({ error: 'GRN entries do not belong to vendor' })
      }

      // Sort by grnDate ascending (FIFO)
      const sorted = [...grns].sort((a, b) => {
        if (!a.grnDate && !b.grnDate) return 0
        if (!a.grnDate) return 1
        if (!b.grnDate) return -1
        return a.grnDate.getTime() - b.grnDate.getTime()
      })

      type FullyPaid = { grnId: string; grnNumber: string; allocatedAmount: number; invoiceNo: string }
      type PartialGrn = {
        grnId: string; grnNumber: string; allocatedAmount: number
        totalAmount: number; remaining: number; invoiceNo: string
      }
      type Excluded = { grnId: string; grnNumber: string; amount: number; invoiceNo: string }

      const fullyPaidGrns: FullyPaid[] = []
      let partialGrn: PartialGrn | null = null
      const excludedGrns: Excluded[] = []

      let running = paymentAmount

      for (const grn of sorted) {
        const remaining = Number(grn.grnAmount) - Number(grn.paidAmount)
        if (running >= remaining) {
          fullyPaidGrns.push({
            grnId: grn.id,
            grnNumber: grn.grnNumber,
            allocatedAmount: remaining,
            invoiceNo: grn.invoice.invoiceNumber,
          })
          running -= remaining
        } else if (running > 0) {
          partialGrn = {
            grnId: grn.id,
            grnNumber: grn.grnNumber,
            allocatedAmount: running,
            totalAmount: Number(grn.grnAmount),
            remaining: remaining - running,
            invoiceNo: grn.invoice.invoiceNumber,
          }
          running = 0
        } else {
          excludedGrns.push({
            grnId: grn.id,
            grnNumber: grn.grnNumber,
            amount: remaining,
            invoiceNo: grn.invoice.invoiceNumber,
          })
        }
      }

      const selectedTotal = sorted.reduce(
        (sum, g) => sum + Number(g.grnAmount) - Number(g.paidAmount),
        0,
      )
      const totalAllocated =
        fullyPaidGrns.reduce((s, g) => s + g.allocatedAmount, 0) +
        (partialGrn?.allocatedAmount ?? 0)

      return {
        fullyPaidGrns,
        partialGrn,
        excludedGrns,
        totalAllocated,
        isExactMatch: Math.abs(paymentAmount - selectedTotal) < 0.01,
      }
    },
  )

  fastify.post(
    '/',
    {
      schema: { tags: ['Payments'], summary: 'Create payment for vendor GRNs' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createPaymentBodySchema.parse(request.body)
      const prisma = request.server.prisma
      const userId = uid(request)

      const paymentDate = new Date(body.paymentDate)
      const periodMonth = paymentDate.getMonth() + 1
      const periodYear = paymentDate.getFullYear()

      const disputedIds = body.includeDisputedIds ?? []
      const allGrnIds = [...body.grnIds, ...disputedIds]

      const payment = await prisma.$transaction(async (tx) => {
        const grnEntries = await tx.grnEntry.findMany({
          where: { id: { in: allGrnIds } },
          include: {
            invoice: {
              include: {
                vendor: { select: { id: true, name: true, email: true } },
                hospital: { select: { name: true } },
              },
            },
          },
        })

        if (grnEntries.length !== allGrnIds.length) {
          throw Object.assign(new Error('One or more GRN entries not found'), { statusCode: 404 })
        }

        const wrongVendor = grnEntries.filter((g) => g.invoice.vendor.id !== body.vendorId)
        if (wrongVendor.length > 0) {
          throw Object.assign(
            new Error(
              `GRN entries do not belong to vendor: ${wrongVendor.map((g) => g.grnNumber).join(', ')}`,
            ),
            { statusCode: 422 },
          )
        }

        const alreadyPaid = grnEntries.filter((g) => g.status === 'paid')
        if (alreadyPaid.length > 0) {
          throw Object.assign(
            new Error(
              `GRN entries already paid: ${alreadyPaid.map((g) => g.grnNumber).join(', ')}`,
            ),
            { statusCode: 422 },
          )
        }

        const ineligible = grnEntries.filter((g) => {
          if (disputedIds.includes(g.id)) return g.status !== 'disputed'
          return !['reconciled', 'partial_paid'].includes(g.status)
        })
        if (ineligible.length > 0) {
          throw Object.assign(
            new Error(
              `GRN entries not eligible for payment: ${ineligible.map((g) => g.grnNumber).join(', ')}`,
            ),
            { statusCode: 422 },
          )
        }

        // Build allocation map
        type AllocationEntry = { amountPaid: number; isPartial: boolean }
        const allocationMap = new Map<string, AllocationEntry>()

        if (body.grnAllocations && body.grnAllocations.length > 0) {
          for (const a of body.grnAllocations) {
            allocationMap.set(a.grnId, { amountPaid: a.amountPaid, isPartial: a.isPartial })
          }
        } else {
          // Fallback: full payment for all GRNs
          for (const g of grnEntries) {
            const remaining = Number(g.grnAmount) - Number(g.paidAmount)
            allocationMap.set(g.id, { amountPaid: remaining, isPartial: false })
          }
        }

        const totalAmount = Array.from(allocationMap.values()).reduce(
          (sum, a) => sum + a.amountPaid,
          0,
        )

        const created = await tx.payment.create({
          data: {
            vendorId: body.vendorId,
            periodMonth,
            periodYear,
            totalAmount,
            paymentDate,
            paymentMode: body.paymentMode,
            transactionRef: body.transactionRef ?? null,
            remarks: body.remarks ?? null,
            createdBy: userId,
            emailSent: false,
          } as unknown as Prisma.PaymentUncheckedCreateInput,
        })

        // Create PaymentGrn rows with amountPaid / isPartial
        await tx.paymentGrn.createMany({
          data: allGrnIds.map((grnId) => {
            const alloc = allocationMap.get(grnId) ?? { amountPaid: 0, isPartial: false }
            return {
              paymentId: created.id,
              grnId,
              amountPaid: alloc.amountPaid,
              isPartial: alloc.isPartial,
            }
          }),
        })

        // Update each GRN's paidAmount and status
        for (const g of grnEntries) {
          const alloc = allocationMap.get(g.id)
          if (!alloc) continue
          const newPaidAmount = Number(g.paidAmount) + alloc.amountPaid
          const grnAmount = Number(g.grnAmount)
          const newStatus =
            newPaidAmount >= grnAmount
              ? 'paid'
              : newPaidAmount > 0
                ? 'partial_paid'
                : g.status

          await tx.grnEntry.update({
            where: { id: g.id },
            data: {
              paidAmount: newPaidAmount,
              status: newStatus,
              updatedAt: new Date(),
            },
          })
        }

        // Update invoice status: paid only if ALL grn_entries are paid (not partial_paid)
        const invoiceIds = [...new Set(grnEntries.map((g) => g.invoiceId))]
        for (const invoiceId of invoiceIds) {
          const unpaidCount = await tx.grnEntry.count({
            where: {
              invoiceId,
              isDeleted: false,
              status: { not: 'paid' },
            },
          })
          if (unpaidCount === 0) {
            await tx.invoice.update({
              where: { id: invoiceId },
              data: { status: 'paid', updatedAt: new Date() },
            })
          }
        }

        if (AUDIT_LOG_ENABLED) {
          await tx.auditLog.create({
            data: {
              userId,
              action: 'CREATE_PAYMENT',
              entityType: 'Payment',
              entityId: created.id,
              newValue: {
                paymentId: created.id,
                vendorId: body.vendorId,
                totalAmount,
                grnIds: allGrnIds,
                paymentMode: body.paymentMode,
              } as Prisma.InputJsonValue,
              ipAddress: request.ip,
            },
          })
        }

        return { payment: created, grnEntries }
      })

      const { grnEntries } = payment
      const vendor = grnEntries[0].invoice.vendor
      const hospitalName = grnEntries[0].invoice.hospital.name
      const totalAmount = Number(payment.payment.totalAmount)
      const outstandingAfter = await remainingOutstanding(prisma, body.vendorId)

      if (body.sendEmail && vendor.email) {
        try {
          const allocationMap = new Map(
            (body.grnAllocations ?? []).map((a) => [a.grnId, a.amountPaid]),
          )
          await emailService.sendPaymentEmail({
            vendorEmail: vendor.email,
            vendorName: vendor.name,
            hospitalName,
            paymentAmount: totalAmount,
            paymentDate: body.paymentDate,
            paymentMode: body.paymentMode,
            transactionRef: body.transactionRef ?? null,
            remarks: body.remarks,
            grns: grnEntries.map((g) => ({
              grnNumber: g.grnNumber,
              grnDate: g.grnDate ? g.grnDate.toISOString().slice(0, 10) : null,
              invoiceNumber: g.invoice.invoiceNumber,
              invoiceDate: g.invoice.invoiceDate
                ? g.invoice.invoiceDate.toISOString().slice(0, 10)
                : null,
              amount: allocationMap.size > 0
                ? (allocationMap.get(g.id) ?? Number(g.grnAmount))
                : Number(g.grnAmount),
            })),
            outstandingAfter,
            customBody: body.emailBody,
          })

          await request.server.prisma.payment.update({
            where: { id: payment.payment.id },
            data: { emailSent: true, emailSentAt: new Date() },
          })
        } catch {
          // Email failure does not roll back the payment
        }
      }

      return reply.code(201).send(payment.payment)
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags: ['Payments'], summary: 'List payments with filters' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { page, limit, vendorId, month, year } = listQuerySchema.parse(request.query)
      const prisma = request.server.prisma
      const skip = (page - 1) * limit

      const where: Prisma.PaymentWhereInput = {
        ...(vendorId ? { vendorId } : {}),
        ...(month ? { periodMonth: month } : {}),
        ...(year ? { periodYear: year } : {}),
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            vendor: { select: { id: true, name: true, email: true } },
            _count: { select: { paymentGrns: true } },
          },
        }),
        prisma.payment.count({ where }),
      ])

      return {
        data: payments,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      }
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags: ['Payments'], summary: 'Get payment details by ID' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = paymentIdParamsSchema.parse(request.params)
      const prisma = request.server.prisma

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          vendor: {
            select: { id: true, name: true, email: true, contactName: true, phone: true },
          },
          paymentGrns: {
            include: {
              grn: {
                include: {
                  invoice: {
                    select: { id: true, invoiceNumber: true, invoiceAmount: true, status: true },
                  },
                },
              },
            },
          },
        },
      })

      if (!payment) return reply.code(404).send({ error: 'Payment not found' })

      return payment
    },
  )

  fastify.post(
    '/:id/resend-email',
    {
      schema: { tags: ['Payments'], summary: 'Resend payment email to vendor' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = paymentIdParamsSchema.parse(request.params)
      const { emailBody } = resendEmailBodySchema.parse(request.body)
      const prisma = request.server.prisma
      const userId = uid(request)

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
              email: true,
              hospital: { select: { name: true } },
            },
          },
          paymentGrns: {
            include: {
              grn: {
                select: {
                  grnNumber: true,
                  grnAmount: true,
                  grnDate: true,
                  invoice: {
                    select: { invoiceNumber: true, invoiceDate: true },
                  },
                },
              },
            },
          },
        },
      })

      if (!payment) return reply.code(404).send({ error: 'Payment not found' })
      if (!payment.vendor.email) return reply.code(422).send({ error: 'Vendor has no email address' })

      const outstandingAfter = await remainingOutstanding(prisma, payment.vendorId)

      await emailService.sendPaymentEmail({
        vendorEmail: payment.vendor.email,
        vendorName: payment.vendor.name,
        hospitalName: payment.vendor.hospital.name,
        paymentAmount: Number(payment.totalAmount),
        paymentDate: payment.paymentDate.toISOString(),
        paymentMode: payment.paymentMode,
        transactionRef: payment.transactionRef,
        remarks: payment.remarks ?? undefined,
        grns: payment.paymentGrns.map((pg) => ({
          grnNumber: pg.grn.grnNumber,
          grnDate: pg.grn.grnDate ? pg.grn.grnDate.toISOString().slice(0, 10) : null,
          invoiceNumber: pg.grn.invoice.invoiceNumber,
          invoiceDate: pg.grn.invoice.invoiceDate
            ? pg.grn.invoice.invoiceDate.toISOString().slice(0, 10)
            : null,
          amount: Number((pg as typeof pg & { amountPaid?: number }).amountPaid ?? pg.grn.grnAmount),
        })),
        outstandingAfter,
        customBody: emailBody,
      })

      const updated = await prisma.payment.update({
        where: { id },
        data: { emailSent: true, emailSentAt: new Date() },
      })

      if (AUDIT_LOG_ENABLED) {
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'RESEND_PAYMENT_EMAIL',
            entityType: 'Payment',
            entityId: id,
            newValue: { emailSentAt: updated.emailSentAt } as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      return { success: true, emailSentAt: updated.emailSentAt }
    },
  )
}
