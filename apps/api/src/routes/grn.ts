import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const checkGrnQuerySchema = z.object({
  grn_number: z.string().min(1),
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

export default async function grnRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/grns/check',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = checkGrnQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.post(
    '/invoices/:id/grns',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = invoiceIdParamsSchema.parse(request.params)
      const body = addGrnBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.delete(
    '/invoices/:id/grns/:grnId',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = grnIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
