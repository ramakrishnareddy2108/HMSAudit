import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const userIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
})

const inviteBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['role_1', 'role_2', 'admin']),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  isActive: z.boolean().optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  departments: {
    select: {
      id: true,
      department: { select: { id: true, name: true } },
    },
  },
} as const

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
      const { page, limit, role, isActive, search } = listQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const where: Prisma.UserWhereInput = {}
      if (role !== undefined) where.role = role
      if (isActive !== undefined) where.isActive = isActive
      if (search?.trim()) {
        where.OR = [
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { email: { contains: search.trim(), mode: 'insensitive' } },
        ]
      }

      const [users, total] = await fastify.prisma.$transaction([
        fastify.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: userSelect,
        }),
        fastify.prisma.user.count({ where }),
      ])

      return {
        data: users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },
  )

  fastify.post(
    '/invite',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = inviteBodySchema.parse(request.body)

      const existing = await fastify.prisma.user.findUnique({ where: { email: body.email } })
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'A user with this email already exists',
        })
      }

      const { error: authError } = await fastify.supabase.auth.admin.inviteUserByEmail(
        body.email,
        { data: { name: body.name } },
      )
      if (authError) {
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: authError.message,
        })
      }

      const user = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { name: body.name, email: body.email, role: body.role, isActive: true },
          select: userSelect,
        })

        if (body.role === 'role_1' && body.departmentIds?.length) {
          await tx.userDepartment.createMany({
            data: body.departmentIds.map((departmentId) => ({
              userId: created.id,
              departmentId,
            })),
          })
        }

        return created
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          newValue: {
            name: body.name,
            email: body.email,
            role: body.role,
            departmentIds: body.departmentIds ?? [],
          } as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return reply.code(201).send(user)
    },
  )

  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = userIdParamsSchema.parse(request.params)
      const body = updateBodySchema.parse(request.body)

      const existing = await fastify.prisma.user.findUnique({ where: { id } })
      if (!existing) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User not found',
        })
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.role !== undefined && { role: body.role }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
          },
          select: userSelect,
        })

        if (body.departmentIds !== undefined) {
          await tx.userDepartment.deleteMany({ where: { userId: id } })
          if (body.departmentIds.length > 0) {
            await tx.userDepartment.createMany({
              data: body.departmentIds.map((departmentId) => ({ userId: id, departmentId })),
            })
          }
        }

        return u
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action: 'UPDATE',
          entityType: 'User',
          entityId: id,
          oldValue: {
            name: existing.name,
            role: existing.role,
            isActive: existing.isActive,
          } as unknown as Prisma.InputJsonValue,
          newValue: body as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return updated
    },
  )

  fastify.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = userIdParamsSchema.parse(request.params)

      if (id === uid(request)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'You cannot deactivate your own account',
        })
      }

      const existing = await fastify.prisma.user.findUnique({ where: { id } })
      if (!existing) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User not found',
        })
      }

      await fastify.prisma.user.update({
        where: { id },
        data: { isActive: false },
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId: uid(request),
          action: 'DELETE',
          entityType: 'User',
          entityId: id,
          oldValue: { isActive: existing.isActive } as unknown as Prisma.InputJsonValue,
          newValue: { isActive: false } as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      })

      return reply.code(204).send()
    },
  )
}
