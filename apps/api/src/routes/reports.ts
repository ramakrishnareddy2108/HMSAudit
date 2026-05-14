import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const periodQuerySchema = z.object({
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2020),
})

const vendorReportQuerySchema = periodQuerySchema.extend({
  vendorId: z.string().uuid().optional(),
})

export default async function reportsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/invoice-summary',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = periodQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/vendor-payments',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = vendorReportQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/reconciliation-summary',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = periodQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/export/invoices',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = periodQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )
}
