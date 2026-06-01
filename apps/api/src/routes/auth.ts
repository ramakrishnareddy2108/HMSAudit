import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
})

const resetPasswordBodySchema = z.object({
  password: z.string().min(8),
})

const inviteBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['role_1', 'role_2', 'admin']),
  departmentIds: z.array(z.string().uuid()).optional(),
})

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = request.body as { email: string; password: string }

      const { data: authData, error: authError } =
        await fastify.supabase.auth.signInWithPassword({ email, password })

      if (authError || !authData.session) {
        return reply.code(401).send({ error: 'Invalid email or password' })
      }

      const user = await fastify.prisma.user.findUnique({
        where: { email },
        include: {
          departments: { include: { department: true } },
        },
      })

      if (!user) {
        return reply.code(401).send({ error: 'User not found in system' })
      }

      if (!user.isActive) {
        return reply.code(403).send({ error: 'Account is deactivated' })
      }

      return reply.send({
        token: authData.session.access_token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          departments: user.departments.map((ud) => ({
            id: ud.department.id,
            name: ud.department.name,
          })),
        },
      })
    },
  )

  fastify.post(
    '/logout',
    { preHandler: [authenticate] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      try {
        await fastify.supabase.auth.signOut()
      } catch {
        // best-effort; token is invalidated on client regardless
      }
      return { success: true }
    },
  )

  fastify.post('/forgot-password', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { email } = forgotPasswordBodySchema.parse(request.body)
    try {
      await fastify.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: (process.env.WEB_URL || 'http://localhost:5173') + '/reset-password',
      })
    } catch {
      // never reveal errors
    }
    return { message: 'If that email exists, a reset link has been sent' }
  })

  // preHandler: [authenticate] — user is already signed in via the magic link token
  fastify.post(
    '/reset-password',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = resetPasswordBodySchema.parse(request.body)
      try {
        const { error } = await fastify.supabase.auth.updateUser({ password })
        if (error) {
          return reply.code(400).send({ error: 'Failed to update password' })
        }
      } catch {
        return reply.code(500).send({ error: 'Internal error updating password' })
      }
      return { success: true }
    },
  )

  fastify.post(
    '/invite',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = inviteBodySchema.parse(request.body)

      try {
        const { error: inviteError } = await fastify.supabase.auth.admin.inviteUserByEmail(
          body.email,
        )
        if (inviteError) {
          return reply.code(400).send({ error: inviteError.message })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send invitation'
        return reply.code(500).send({ error: msg })
      }

      const createdUser = await fastify.prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          role: body.role,
          isActive: true,
        },
      })

      if (body.departmentIds?.length && body.role === 'role_1') {
        await fastify.prisma.userDepartment.createMany({
          data: body.departmentIds.map((departmentId) => ({
            userId: createdUser.id,
            departmentId,
          })),
        })
      }

      await fastify.prisma.auditLog.create({
        data: {
          userId: (request.user as User).id,
          action: 'user_invited',
          entityType: 'user',
          entityId: createdUser.id,
          newValue: { name: body.name, email: body.email, role: body.role },
          ipAddress: request.ip,
        },
      })

      return fastify.prisma.user.findUnique({
        where: { id: createdUser.id },
        include: { departments: { include: { department: true } } },
      })
    },
  )
}
