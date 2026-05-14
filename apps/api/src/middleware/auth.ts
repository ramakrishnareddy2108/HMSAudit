import { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@prisma/client'

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' })
  }

  try {
    const decoded = await request.jwtVerify<{ sub: string }>()
    const user = await request.server.prisma.user.findUnique({
      where: { id: decoded.sub },
    })

    if (!user) {
      return reply.status(401).send({ error: 'User not found' })
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'User account is inactive' })
    }

    request.user = user
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' })
  }
}

export function requireRole(...roles: Role[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}
