import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const eligibleGrnsQuerySchema = z.object({
  vendorId: z.string().uuid(),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2020),
})

const createPaymentBodySchema = z.object({
  vendorId: z.string().uuid(),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2020),
  grnIds: z.array(z.string().uuid()).min(1),
  paymentDate: z.string(),
  paymentMode: z.enum(['neft', 'rtgs', 'cheque', 'cash']),
  transactionRef: z.string().optional(),
  remarks: z.string().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vendorId: z.string().uuid().optional(),
})

export default async function paymentsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/eligible-grns',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = eligibleGrnsQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = createPaymentBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )

  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = paymentIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )

  fastify.post(
    '/:id/resend-email',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = paymentIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
