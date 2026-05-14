import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const vendorIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createVendorBodySchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  gstNumber: z.string().optional(),
  bankDetails: z.record(z.unknown()).optional(),
})

const updateVendorBodySchema = createVendorBodySchema.partial()

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
})

export default async function vendorsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = listQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = createVendorBodySchema.parse(request.body)
      return { todo: 'implement', body }
    },
  )

  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = vendorIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )

  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = vendorIdParamsSchema.parse(request.params)
      const body = updateVendorBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.patch(
    '/:id/toggle-active',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = vendorIdParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
