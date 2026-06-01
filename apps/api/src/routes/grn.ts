import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'

const checkGrnQuerySchema = z.object({
  grnNumber: z.string().min(1),
})

const invoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const grnIdParamsSchema = z.object({
  id: z.string().uuid(),
  grnId: z.string().uuid(),
})

const addGrnBodySchema = z.object({
  grnNumber: z.string().min(1),
  grnAmount: z.number().positive(),
  grnDate: z.string().optional(),
})

const LOCKED_STATUSES = ['reconciled', 'paid'] as const

export default async function grnRoutes(fastify: FastifyInstance) {
  // GET /grns/check
  fastify.get(
    '/grns/check',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { grnNumber } = checkGrnQuerySchema.parse(request.query)

      const existing = await fastify.prisma.grnEntry.findUnique({
        where: { grnNumber },
        include: {
          invoice: {
            include: {
              vendor: { select: { name: true } },
              uploader: { select: { name: true } },
            },
          },
        },
      })

      if (!existing) {
        return { isDuplicate: false }
      }

      return {
        isDuplicate: true,
        existing: {
          grnNumber: existing.grnNumber,
          grnAmount: existing.grnAmount,
          grnDate: existing.grnDate,
          invoiceId: existing.invoiceId,
          invoiceNumber: existing.invoice.invoiceNumber,
          vendorName: existing.invoice.vendor.name,
          uploadedBy: existing.invoice.uploader.name,
          createdAt: existing.createdAt,
        },
      }
    },
  )

  // POST /invoices/:id/grns
  fastify.post(
    '/invoices/:id/grns',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = invoiceIdParamsSchema.parse(request.params)
      const body = addGrnBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: { grnEntries: true },
      })

      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      if ((request.user as User).role === 'role_1' && invoice.uploadedBy !== userId) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      if (LOCKED_STATUSES.includes(invoice.status as (typeof LOCKED_STATUSES)[number])) {
        return reply.code(403).send({ error: 'Invoice is locked and cannot be modified' })
      }

      // GRN uniqueness check at application level
      const existing = await fastify.prisma.grnEntry.findUnique({
        where: { grnNumber: body.grnNumber },
        include: {
          invoice: {
            include: {
              vendor: { select: { name: true } },
              uploader: { select: { name: true } },
            },
          },
        },
      })

      if (existing) {
        return reply.code(409).send({
          error: 'GRN_DUPLICATE',
          existing: {
            grnNumber: existing.grnNumber,
            grnAmount: existing.grnAmount,
            invoiceId: existing.invoiceId,
            invoiceNumber: existing.invoice.invoiceNumber,
            vendorName: existing.invoice.vendor.name,
          },
        })
      }

      // GRN total validation
      const currentTotal = invoice.grnEntries.reduce(
        (sum, g) => sum + Number(g.grnAmount),
        0,
      )
      const newTotal = currentTotal + body.grnAmount
      const invoiceAmount = Number(invoice.invoiceAmount)

      if (newTotal > invoiceAmount) {
        return reply.code(400).send({
          error: 'GRN_TOTAL_EXCEEDS_INVOICE',
          invoiceAmount,
          currentTotal,
          newTotal,
        })
      }

      const grn = await fastify.prisma.grnEntry.create({
        data: {
          invoiceId: id,
          grnNumber: body.grnNumber,
          grnAmount: body.grnAmount,
          grnDate: body.grnDate ? new Date(body.grnDate) : null,
        },
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'grn_added',
          entityType: 'grn_entry',
          entityId: grn.id,
          newValue: { grnNumber: grn.grnNumber, grnAmount: body.grnAmount, invoiceId: id },
          ipAddress: request.ip,
        },
      })

      return reply.code(201).send(grn)
    },
  )

  // DELETE /invoices/:id/grns/:grnId
  fastify.delete(
    '/invoices/:id/grns/:grnId',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, grnId } = grnIdParamsSchema.parse(request.params)
      const userId = (request.user as User).id

      const grn = await fastify.prisma.grnEntry.findUnique({
        where: { id: grnId },
        include: { invoice: true },
      })

      if (!grn) return reply.code(404).send({ error: 'GRN not found' })
      if (grn.invoiceId !== id) return reply.code(404).send({ error: 'GRN not found on this invoice' })

      if ((request.user as User).role === 'role_1' && grn.invoice.uploadedBy !== userId) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      if (['reconciled', 'paid'].includes(grn.status)) {
        return reply.code(403).send({ error: 'Cannot delete a locked GRN' })
      }

      await fastify.prisma.grnEntry.delete({ where: { id: grnId } })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'grn_deleted',
          entityType: 'grn_entry',
          entityId: grnId,
          newValue: { grnNumber: grn.grnNumber, invoiceId: id },
          ipAddress: request.ip,
        },
      })

      return { success: true }
    },
  )
}
