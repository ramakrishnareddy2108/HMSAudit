import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const syncRunIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const conflictParamsSchema = z.object({
  id: z.string().uuid(),
  conflictId: z.string().uuid(),
})

const resolveConflictBodySchema = z.object({
  resolution: z.enum(['keep_system', 'use_excel']),
  adminNote: z.string().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export default async function grnSyncRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/upload',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return { todo: 'implement' }
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
    '/runs/:id/conflicts',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = syncRunIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )

  fastify.post(
    '/runs/:id/conflicts/:conflictId/resolve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = conflictParamsSchema.parse(request.params)
      const body = resolveConflictBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )
}
