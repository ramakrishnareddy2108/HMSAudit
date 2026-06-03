import { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@prisma/client'
import { tenantStorage } from './tenancy'

export function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const token = request.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' })
    done()
    return
  }

  void (async () => {
    try {
      const {
        data: { user },
        error,
      } = await request.server.supabase.auth.getUser(token)

      if (error || !user) {
        reply.code(401).send({ error: 'Invalid token' })
        done()
        return
      }

      const dbUser = await request.server.prisma.user.findUnique({
        where: { email: user.email! },
        include: {
          departments: { include: { department: true } },
        },
      })

      if (!dbUser) {
        reply.code(401).send({ error: 'User not provisioned' })
        done()
        return
      }

      if (!dbUser.isActive) {
        reply.code(403).send({ error: 'Account deactivated' })
        done()
        return
      }

      const headerValue = request.headers['x-hospital-id']
      const activeHospitalId: string | null = dbUser.isSuperAdmin
        ? ((Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? null)
        : dbUser.hospitalId

      request.user = { ...dbUser, activeHospitalId }

      // run() creates a scoped async context — all downstream handlers
      // (route handler and anything it awaits) inherit this store value.
      // enterWith() only mutates the current context and is unsafe when
      // Fastify wraps route handlers in their own AsyncResource.
      tenantStorage.run(activeHospitalId, done)
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)))
    }
  })()
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

export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user?.isSuperAdmin) {
    return reply.status(403).send({ error: 'Super admin access required' })
  }
}
