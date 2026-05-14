import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const userIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['role_1', 'role_2', 'admin']),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const updateUserBodySchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  isActive: z.coerce.boolean().optional(),
})

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/me',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      return { user: request.user }
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

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = createUserBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )

  fastify.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = userIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )

  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = userIdParamsSchema.parse(request.params)
      const body = updateUserBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.patch(
    '/:id/toggle-active',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = userIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
