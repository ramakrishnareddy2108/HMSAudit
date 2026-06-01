import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { emailService } from '../services/emailService'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const eligibleGrnsQuerySchema = z.object({
  vendorId: z.string().uuid(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020),
})

const createPaymentBodySchema = z.object({
  vendorId: z.string().uuid(),
  grnIds: z.array(z.string().uuid()).min(1),
  paymentDate: z.string(),
  paymentMode: z.enum(['neft', 'rtgs', 'cheque', 'cash']),
  transactionRef: z.string().optional(),
  remarks: z.string().optional(),
  emailBody: z.string(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vendorId: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).optional(),
})

const resendEmailBodySchema = z.object({
  emailBody: z.string(),
})

export default async function paymentsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/eligible-grns',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { vendorId, month, year } = eligibleGrnsQuerySchema.parse(request.query)
      const prisma = request.server.prisma

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, name: true, email: true, contactName: true },
      })
      if (!vendor) return reply.code(404).send({ error: 'Vendor not found' })

      const startDate = new Date(year, month - 1, 1)
      const endDate = new Date(year, month, 1)

      const grnWhere: Prisma.GrnEntryWhereInput = {
        invoice: { vendorId },
        OR: [
          { grnDate: { gte: startDate, lt: endDate } },
          { grnDate: null },
        ],
      }

      const [grns, disputedGrns] = await Promise.all([
        prisma.grnEntry.findMany({
          where: { ...grnWhere, status: 'reconciled' },
          include: {
            invoice: {
              select: { id: true, invoiceNumber: true, invoiceAmount: true },
            },
          },
          orderBy: [{ grnDate: 'asc' }, { grnNumber: 'asc' }],
        }),
        prisma.grnEntry.findMany({
          where: { ...grnWhere, status: 'disputed' },
          include: {
            invoice: {
              select: { id: true, invoiceNumber: true, invoiceAmount: true },
            },
          },
          orderBy: [{ grnDate: 'asc' }, { grnNumber: 'asc' }],
        }),
      ])

      const totalAmount = grns.reduce((sum, g) => sum + Number(g.grnAmount), 0)

      return { grns, disputedGrns, totalAmount, vendor }
    },
  )

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createPaymentBodySchema.parse(request.body)
      const prisma = request.server.prisma
      const userId = uid(request)

      const paymentDate = new Date(body.paymentDate)
      const periodMonth = paymentDate.getMonth() + 1
      const periodYear = paymentDate.getFullYear()

      const payment = await prisma.$transaction(async (tx) => {
        // 1. Verify all grnIds are reconciled and not paid
        const grnEntries = await tx.grnEntry.findMany({
          where: { id: { in: body.grnIds } },
          include: {
            invoice: {
              include: {
                vendor: { select: { id: true, name: true, email: true } },
              },
            },
          },
        })

        if (grnEntries.length !== body.grnIds.length) {
          throw Object.assign(new Error('One or more GRN entries not found'), { statusCode: 404 })
        }

        const ineligible = grnEntries.filter((g) => g.status !== 'reconciled')
        if (ineligible.length > 0) {
          throw Object.assign(
            new Error(`GRN entries not eligible for payment: ${ineligible.map((g) => g.grnNumber).join(', ')}`),
            { statusCode: 422 },
          )
        }

        // 2. Calculate totalAmount
        const totalAmount = grnEntries.reduce((sum, g) => sum + Number(g.grnAmount), 0)

        // 3. Create Payment record
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
          },
        })

        // 4. Create PaymentGrn rows
        await tx.paymentGrn.createMany({
          data: body.grnIds.map((grnId) => ({ paymentId: created.id, grnId })),
        })

        // 5. Update each GrnEntry: status = paid
        await tx.grnEntry.updateMany({
          where: { id: { in: body.grnIds } },
          data: { status: 'paid', updatedAt: new Date() },
        })

        // 6. Check each invoice: if ALL grnEntries paid → invoice.status = paid
        const invoiceIds = [...new Set(grnEntries.map((g) => g.invoiceId))]
        for (const invoiceId of invoiceIds) {
          const remainingUnpaid = await tx.grnEntry.count({
            where: { invoiceId, status: { not: 'paid' } },
          })
          if (remainingUnpaid === 0) {
            await tx.invoice.update({
              where: { id: invoiceId },
              data: { status: 'paid', updatedAt: new Date() },
            })
          }
        }

        // 7 (deferred). Write audit_log
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
              grnIds: body.grnIds,
              paymentMode: body.paymentMode,
            } as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })

        return { payment: created, grnEntries }
      })

      // 8. Send email outside transaction to avoid holding connection during network call
      const { grnEntries } = payment
      const vendor = grnEntries[0].invoice.vendor
      const totalAmount = grnEntries.reduce((sum, g) => sum + Number(g.grnAmount), 0)

      if (vendor.email) {
        try {
          await emailService.sendPaymentEmail({
            vendorEmail: vendor.email,
            vendorName: vendor.name,
            paymentAmount: totalAmount,
            paymentDate: body.paymentDate,
            paymentMode: body.paymentMode,
            transactionRef: body.transactionRef ?? null,
            remarks: body.remarks,
            grns: grnEntries.map((g) => ({
              grnNumber: g.grnNumber,
              invoiceNumber: g.invoice.invoiceNumber,
              amount: Number(g.grnAmount),
            })),
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
    { preHandler: [authenticate, requireRole('admin')] },
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
    { preHandler: [authenticate, requireRole('admin')] },
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
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = paymentIdParamsSchema.parse(request.params)
      const { emailBody } = resendEmailBodySchema.parse(request.body)
      const prisma = request.server.prisma
      const userId = uid(request)

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          vendor: { select: { id: true, name: true, email: true } },
          paymentGrns: {
            include: {
              grn: {
                include: {
                  invoice: { select: { invoiceNumber: true } },
                },
              },
            },
          },
        },
      })

      if (!payment) return reply.code(404).send({ error: 'Payment not found' })
      if (!payment.vendor.email) return reply.code(422).send({ error: 'Vendor has no email address' })

      await emailService.sendPaymentEmail({
        vendorEmail: payment.vendor.email,
        vendorName: payment.vendor.name,
        paymentAmount: Number(payment.totalAmount),
        paymentDate: payment.paymentDate.toISOString(),
        paymentMode: payment.paymentMode,
        transactionRef: payment.transactionRef,
        remarks: payment.remarks ?? undefined,
        grns: payment.paymentGrns.map((pg) => ({
          grnNumber: pg.grn.grnNumber,
          invoiceNumber: pg.grn.invoice.invoiceNumber,
          amount: Number(pg.grn.grnAmount),
        })),
        customBody: emailBody,
      })

      const updated = await prisma.payment.update({
        where: { id },
        data: { emailSent: true, emailSentAt: new Date() },
      })

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

      return { success: true, emailSentAt: updated.emailSentAt }
    },
  )
}
