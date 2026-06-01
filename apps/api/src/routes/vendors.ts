import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User, InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const vendorIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const PHONE_RE = /^[6-9]\d{9}$/
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

const createVendorBodySchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z
    .string()
    .regex(PHONE_RE, 'Enter a valid 10-digit Indian mobile number (starts with 6–9)')
    .optional(),
  email: z.string().email('Invalid email format').optional(),
  gstNumber: z
    .string()
    .regex(GST_RE, 'Invalid GST number — must be 15 characters (e.g. 22ABCDE1234F1Z5)')
    .optional(),
  bankName: z.string().min(1).optional(),
  bankAccountNumber: z.string().min(1).optional(),
  bankIfscCode: z
    .string()
    .regex(IFSC_RE, 'Invalid IFSC code — must be 11 characters (e.g. HDFC0001234)')
    .optional(),
  bankAccountName: z.string().min(1).optional(),
  bankBranch: z.string().optional(),
})

const updateVendorBodySchema = createVendorBodySchema.partial().extend({
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
})

type CreateBody = z.infer<typeof createVendorBodySchema>
type UpdateBody = z.infer<typeof updateVendorBodySchema>

function bankGroupError(body: Partial<CreateBody>): string | null {
  const group = [body.bankName, body.bankAccountNumber, body.bankIfscCode, body.bankAccountName]
  const filled = group.filter((v) => v && v.trim()).length
  if (filled > 0 && filled < 4) {
    return 'Bank details are all-or-nothing: bankName, bankAccountNumber, bankIfscCode, and bankAccountName must all be provided or all left empty.'
  }
  return null
}

// Non-final statuses that block vendor deletion
const BLOCKING_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.draft,
  InvoiceStatus.pending_review,
  InvoiceStatus.sent_back,
  InvoiceStatus.re_submitted,
  InvoiceStatus.approved,
]

export default async function vendorsRoutes(fastify: FastifyInstance) {
  // GET /vendors — paginated list, all roles
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { page, limit, search, isActive } = listQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const where: Prisma.VendorWhereInput = { deletedAt: null }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { gstNumber: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (isActive !== undefined) {
        where.isActive = isActive
      }

      const [vendors, total] = await Promise.all([
        request.server.prisma.vendor.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          include: { _count: { select: { invoices: true } } },
        }),
        request.server.prisma.vendor.count({ where }),
      ])

      return {
        data: vendors,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },
  )

  // POST /vendors — admin only
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createVendorBodySchema.parse(request.body)

      const bankErr = bankGroupError(body)
      if (bankErr) return reply.status(400).send({ error: bankErr })

      const existing = await request.server.prisma.vendor.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' }, deletedAt: null },
      })
      if (existing) {
        return reply.status(409).send({ error: 'Vendor already exists' })
      }

      const vendor = await request.server.prisma.vendor.create({ data: body })

      await request.server.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action: 'CREATE',
          entityType: 'Vendor',
          entityId: vendor.id,
          newValue: body as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return reply.status(201).send(vendor)
    },
  )

  // GET /vendors/:id — all roles, includes invoice count
  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)

      const vendor = await request.server.prisma.vendor.findUnique({
        where: { id },
        include: { _count: { select: { invoices: true } } },
      })

      if (!vendor || vendor.deletedAt) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      return vendor
    },
  )

  // PUT /vendors/:id — update fields + isActive toggle (both directions)
  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)
      const body = updateVendorBodySchema.parse(request.body) as UpdateBody

      const existing = await request.server.prisma.vendor.findUnique({ where: { id } })
      if (!existing || existing.deletedAt) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      const bankErr = bankGroupError(body)
      if (bankErr) return reply.status(400).send({ error: bankErr })

      if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await request.server.prisma.vendor.findFirst({
          where: {
            name: { equals: body.name, mode: 'insensitive' },
            id: { not: id },
            deletedAt: null,
          },
        })
        if (duplicate) {
          return reply.status(409).send({ error: 'Vendor already exists' })
        }
      }

      const updated = await request.server.prisma.vendor.update({
        where: { id },
        data: body,
      })

      const isActivating = body.isActive === true && !existing.isActive
      const isDeactivating = body.isActive === false && existing.isActive
      const action = isActivating ? 'ACTIVATE' : isDeactivating ? 'DEACTIVATE' : 'UPDATE'

      await request.server.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action,
          entityType: 'Vendor',
          entityId: id,
          oldValue: {
            name: existing.name,
            contactName: existing.contactName,
            phone: existing.phone,
            email: existing.email,
            gstNumber: existing.gstNumber,
            isActive: existing.isActive,
          } as unknown as Prisma.InputJsonValue,
          newValue: body as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return updated
    },
  )

  // DELETE /vendors/:id — blocking check then soft delete (sets deletedAt)
  fastify.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)

      const existing = await request.server.prisma.vendor.findUnique({ where: { id } })
      if (!existing || existing.deletedAt) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      // Check for active invoices and reconciled-but-unpaid GRNs in parallel
      const [activeInvoices, unpaidGrns] = await Promise.all([
        request.server.prisma.invoice.count({
          where: { vendorId: id, status: { in: BLOCKING_INVOICE_STATUSES } },
        }),
        request.server.prisma.grnEntry.count({
          where: {
            status: 'reconciled',
            invoice: { vendorId: id },
          },
        }),
      ])

      if (activeInvoices > 0 || unpaidGrns > 0) {
        return reply.status(409).send({
          error: 'Vendor cannot be deleted while blocking items exist.',
          blockers: { activeInvoices, unpaidGrns },
        })
      }

      const now = new Date()
      await request.server.prisma.vendor.update({
        where: { id },
        data: { deletedAt: now, isActive: false },
      })

      await request.server.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action: 'DELETE',
          entityType: 'Vendor',
          entityId: id,
          oldValue: { name: existing.name, isActive: existing.isActive } as unknown as Prisma.InputJsonValue,
          newValue: { deletedAt: now.toISOString() } as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return { success: true }
    },
  )
}
