import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const runParamsSchema = z.object({
  id: z.string().uuid(),
})

const resultParamsSchema = z.object({
  id: z.string().uuid(),
  resultId: z.string().uuid(),
})

const startReconBodySchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2020),
})

const resolveResultBodySchema = z.object({
  resolution: z.enum(['accepted_app', 'accepted_excel', 'disputed']),
  adminNote: z.string().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const resultsQuerySchema = z.object({
  matchStatus: z.enum(['matched', 'amount_diff', 'app_only', 'excel_only']).optional(),
})

export default async function reconciliationRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/run',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = startReconBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )

  fastify.get(
    '/runs',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/runs/:id/results',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = runParamsSchema.parse(request.params)
      const query = resultsQuerySchema.parse(request.query)
      return { todo: 'implement', params, query }
    },
  )

  fastify.post(
    '/runs/:id/results/:resultId/resolve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = resultParamsSchema.parse(request.params)
      const body = resolveResultBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.post(
    '/runs/:id/complete',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = runParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
