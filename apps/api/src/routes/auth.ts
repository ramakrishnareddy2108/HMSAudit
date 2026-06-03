import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with email and password',
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
      const { email, password } = loginBodySchema.parse(request.body)

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
          hospitalId: user.hospitalId,
          isSuperAdmin: user.isSuperAdmin,
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
    { schema: { tags: ['Auth'], summary: 'Logout current session' }, preHandler: [authenticate] },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      try {
        await fastify.supabase.auth.signOut()
      } catch {
        // best-effort; token is invalidated on client regardless
      }
      return { success: true }
    },
  )
}
