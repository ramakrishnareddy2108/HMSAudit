import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { cacheService } from '../services/cacheService'
import { AUDIT_LOG_ENABLED } from '../constants'

function uid(request: FastifyRequest): string {
  return request.user.id
}

const userIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(20),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
})

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['role_1', 'role_2', 'admin']),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['role_1', 'role_2', 'admin']).optional(),
  isActive: z.boolean().optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
})

const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8),
})

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  hospitalId: true,
  isSuperAdmin: true,
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
    {
      schema: { tags: ['Users'], summary: 'Get current user profile' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      return { user: request.user }
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags: ['Users'], summary: 'List users with filters' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { page, limit, role, isActive, search } = listQuerySchema.parse(request.query)
      const skip = (page - 1) * limit

      const requestingUser = request.user
      const cacheHospitalId = requestingUser.isSuperAdmin
        ? (requestingUser.activeHospitalId ?? 'global')
        : (requestingUser.hospitalId ?? 'global')
      const cacheKey = `users_${cacheHospitalId}_p${page}_l${limit}_r${role ?? ''}_a${String(isActive ?? '')}_s${search ?? ''}`

      const cached = cacheService.get(cacheKey)
      if (cached) return cached

      const where: Prisma.UserWhereInput = { isSuperAdmin: false }

      if (!requestingUser.isSuperAdmin) {
        where.hospitalId = requestingUser.hospitalId
      } else if (requestingUser.activeHospitalId) {
        where.hospitalId = requestingUser.activeHospitalId
      }

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

      const result = {
        data: users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }

      cacheService.set(cacheKey, result)
      return result
    },
  )

  fastify.post(
    '/create',
    {
      schema: { tags: ['Users'], summary: 'Create user with password' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createBodySchema.parse(request.body)
      const requestingUser = request.user

      const targetHospitalId = requestingUser.isSuperAdmin
        ? (requestingUser.activeHospitalId ?? null)
        : (requestingUser.hospitalId ?? null)

      if (!targetHospitalId) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Select a hospital before creating users',
        })
      }

      if (!requestingUser.isSuperAdmin && body.role === 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Hospital admin cannot create admin users',
        })
      }

      const existing = await fastify.prisma.user.findUnique({ where: { email: body.email } })
      if (existing) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'A user with this email already exists',
        })
      }

      const { data: authData, error: authError } = await fastify.supabase.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      })
      if (authError) {
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: authError.message,
        })
      }

      const user = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: body.name,
            email: body.email,
            role: body.role,
            isActive: true,
            hospitalId: targetHospitalId,
            supabaseId: authData.user?.id ?? undefined,
          },
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

      if (AUDIT_LOG_ENABLED) {
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
      }

      cacheService.deleteByPrefix(`users_${targetHospitalId}`)
      return reply.code(201).send(user)
    },
  )

  fastify.post(
    '/:id/reset-password',
    {
      schema: { tags: ['Users'], summary: 'Reset user password (admin only)' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = userIdParamsSchema.parse(request.params)
      const { newPassword } = resetPasswordBodySchema.parse(request.body)
      const requestingUser = request.user

      const target = await fastify.prisma.user.findUnique({ where: { id } })
      if (!target) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User not found',
        })
      }

      if (target.isSuperAdmin && !requestingUser.isSuperAdmin) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Cannot reset a super admin password',
        })
      }

      if (!requestingUser.isSuperAdmin && target.hospitalId !== requestingUser.hospitalId) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Cannot reset password for users outside your hospital',
        })
      }

      let supabaseUserId = target.supabaseId
      if (!supabaseUserId) {
        const { data: listData } = await fastify.supabase.auth.admin.listUsers({ perPage: 1000 })
        supabaseUserId = listData?.users?.find((u) => u.email === target.email)?.id ?? null
      }

      if (!supabaseUserId) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Auth user not found',
        })
      }

      const { error } = await fastify.supabase.auth.admin.updateUserById(supabaseUserId, {
        password: newPassword,
      })
      if (error) {
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: error.message,
        })
      }

      if (AUDIT_LOG_ENABLED) {
        await fastify.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'RESET_PASSWORD',
            entityType: 'User',
            entityId: id,
            newValue: { resetBy: uid(request), timestamp: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      return { success: true }
    },
  )

  fastify.put(
    '/:id',
    {
      schema: { tags: ['Users'], summary: 'Update user details' },
      preHandler: [authenticate, requireRole('admin')],
    },
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

      if (AUDIT_LOG_ENABLED) {
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
      }

      cacheService.deleteByPrefix(`users_${existing.hospitalId}`)
      return updated
    },
  )

  fastify.delete(
    '/:id',
    {
      schema: { tags: ['Users'], summary: 'Deactivate user account' },
      preHandler: [authenticate, requireRole('admin')],
    },
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

      if (AUDIT_LOG_ENABLED) {
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
      }

      cacheService.deleteByPrefix(`users_${existing.hospitalId}`)
      return reply.code(204).send()
    },
  )
}
