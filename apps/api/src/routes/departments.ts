import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

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
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { isActive } = listQuerySchema.parse(request.query)

      return fastify.prisma.department.findMany({
        where: isActive === undefined ? undefined : { isActive },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          _count: { select: { invoices: true } },
        },
      })
    },
  )

  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createBodySchema.parse(request.body)

      const existing = await fastify.prisma.department.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' } },
      })
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Department name already exists',
        })
      }

      const department = await fastify.prisma.department.create({ data: body })

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

      return reply.code(201).send(department)
    },
  )

  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const body = updateBodySchema.parse(request.body)

      const existing = await fastify.prisma.department.findUnique({ where: { id } })
      if (!existing) {
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

      return updated
    },
  )
}
