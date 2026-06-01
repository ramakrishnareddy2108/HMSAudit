import { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@prisma/client'

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }

  const {
    data: { user },
    error,
  } = await request.server.supabase.auth.getUser(token)

  if (error || !user) {
    return reply.code(401).send({ error: 'Invalid token' })
  }

  const dbUser = await request.server.prisma.user.findUnique({
    where: { email: user.email! },
    include: {
      departments: { include: { department: true } },
    },
  })

  if (!dbUser) {
    return reply.code(401).send({ error: 'User not provisioned' })
  }

  if (!dbUser.isActive) {
    return reply.code(403).send({ error: 'Account deactivated' })
  }

  request.user = dbUser
}

export function requireRole(...roles: Role[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!roles.includes((request.user as { role: Role }).role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}
