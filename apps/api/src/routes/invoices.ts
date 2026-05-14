import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['draft', 'pending_review', 'sent_back', 're_submitted', 'approved', 'reconciled', 'paid'])
    .optional(),
  vendorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const createInvoiceBodySchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().optional(),
  invoiceAmount: z.number().positive(),
  departmentId: z.string().uuid().optional(),
  billType: z.enum(['grn_bill', 'miscellaneous']),
  miscCategory: z.string().optional(),
  miscDescription: z.string().optional(),
})

const updateInvoiceBodySchema = createInvoiceBodySchema.partial()

const approveBodySchema = z.object({
  note: z.string().optional(),
})

const sendBackBodySchema = z.object({
  reason: z.string().min(1),
})

const checkDuplicateQuerySchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
})

export default async function invoiceRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/check-duplicate',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = checkDuplicateQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = invoiceListQuerySchema.parse(request.query)
      return { todo: 'implement', query }
    },
  )

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return { todo: 'implement' }
    },
  )

  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = idParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )

  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = idParamsSchema.parse(request.params)
      const body = updateInvoiceBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.post(
    '/:id/approve',
    { preHandler: [authenticate, requireRole('role_2', 'admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = idParamsSchema.parse(request.params)
      const body = approveBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.post(
    '/:id/send-back',
    { preHandler: [authenticate, requireRole('role_2', 'admin')] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = idParamsSchema.parse(request.params)
      const body = sendBackBodySchema.parse(request.body)
      return { todo: 'implement', params, body }
    },
  )

  fastify.get(
    '/:id/versions',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const params = idParamsSchema.parse(request.params)
      return { todo: 'implement', params }
    },
  )
}
