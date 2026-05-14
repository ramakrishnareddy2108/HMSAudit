import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
})

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = loginBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )

  fastify.post(
    '/logout',
    { preHandler: [authenticate] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return { todo: 'implement' }
    },
  )

  fastify.post(
    '/refresh',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = refreshBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )
}
