import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User, InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { cacheService } from '../services/cacheService'
import { AUDIT_LOG_ENABLED } from '../constants'

const BLOCKING_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.draft,
  InvoiceStatus.pending_review,
  InvoiceStatus.sent_back,
  InvoiceStatus.re_submitted,
  InvoiceStatus.approved,
]

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const listQuerySchema = z.object({
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
})

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
})

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
})

export default async function departmentRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: { tags: ['Departments'], summary: 'List all departments' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { isActive } = listQuerySchema.parse(request.query)
      const hospitalId = request.user.activeHospitalId ?? 'global'
      const cacheKey = `departments_${hospitalId}_a${String(isActive ?? '')}`

      const cached = cacheService.get(cacheKey)
      if (cached) {
        reply.header('Cache-Control', 'private, max-age=3600')
        return cached
      }

      const where: Prisma.DepartmentWhereInput = { isDeleted: false }
      if (isActive !== undefined) where.isActive = isActive

      const result = await fastify.prisma.department.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          _count: { select: { invoices: true } },
        },
      })

      cacheService.set(cacheKey, result)
      reply.header('Cache-Control', 'private, max-age=3600')
      return result
    },
  )

  fastify.post(
    '/',
    {
      schema: { tags: ['Departments'], summary: 'Create a new department' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createBodySchema.parse(request.body)

      const existing = await fastify.prisma.department.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' }, isDeleted: false },
      })
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Department name already exists',
        })
      }

      const department = await fastify.prisma.department.create({
        data: body as unknown as Prisma.DepartmentUncheckedCreateInput,
      })

      if (AUDIT_LOG_ENABLED) {
        await fastify.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'CREATE',
            entityType: 'Department',
            entityId: department.id,
            newValue: body as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`departments_${request.user.activeHospitalId ?? 'global'}`)
      return reply.code(201).send(department)
    },
  )

  fastify.put(
    '/:id',
    {
      schema: { tags: ['Departments'], summary: 'Update department details' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const body = updateBodySchema.parse(request.body)

      const existing = await fastify.prisma.department.findUnique({ where: { id } })
      if (!existing || existing.isDeleted) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Department not found',
        })
      }

      if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await fastify.prisma.department.findFirst({
          where: {
            name: { equals: body.name, mode: 'insensitive' },
            id: { not: id },
            isDeleted: false,
          },
        })
        if (duplicate) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Department name already exists',
          })
        }
      }

      const updated = await fastify.prisma.department.update({
        where: { id },
        data: body,
      })

      if (AUDIT_LOG_ENABLED) {
        await fastify.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'UPDATE',
            entityType: 'Department',
            entityId: id,
            oldValue: {
              name: existing.name,
              isActive: existing.isActive,
            } as unknown as Prisma.InputJsonValue,
            newValue: body as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`departments_${request.user.activeHospitalId ?? 'global'}`)
      return updated
    },
  )

  fastify.delete(
    '/:id',
    {
      schema: { tags: ['Departments'], summary: 'Delete department by ID' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)

      const existing = await fastify.prisma.department.findUnique({ where: { id } })
      if (!existing || existing.isDeleted) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Department not found' })
      }

      const activeInvoices = await fastify.prisma.invoice.count({
        where: { departmentId: id, status: { in: BLOCKING_INVOICE_STATUSES } },
      })

      if (activeInvoices > 0) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Department cannot be deleted while active invoices exist.',
          blockers: { activeInvoices },
        })
      }

      await fastify.prisma.department.update({
        where: { id },
        data: { isDeleted: true, isActive: false },
      })

      if (AUDIT_LOG_ENABLED) {
        await fastify.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'DELETE',
            entityType: 'Department',
            entityId: id,
            oldValue: { name: existing.name, isActive: existing.isActive } as unknown as Prisma.InputJsonValue,
            newValue: { isDeleted: true } as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`departments_${request.user.activeHospitalId ?? 'global'}`)
      return { success: true }
    },
  )
}
