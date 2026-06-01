import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { type User } from '@prisma/client'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const markReadBodySchema = z
  .object({
    notificationIds: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional(),
  })
  .refine(
    (d) => d.all === true || (Array.isArray(d.notificationIds) && d.notificationIds.length > 0),
    { message: 'Provide all:true or a non-empty notificationIds array' },
  )

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/unread-count',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const count = await fastify.prisma.notification.count({
        where: { userId: uid(request), isRead: false },
      })
      return { count }
    },
  )

  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { unreadOnly, page, limit } = listQuerySchema.parse(request.query)
      const userId = uid(request)
      const skip = (page - 1) * limit

      const where = {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      }

      const [notifications, total] = await Promise.all([
        fastify.prisma.notification.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            message: true,
            type: true,
            entityType: true,
            entityId: true,
            isRead: true,
            createdAt: true,
          },
        }),
        fastify.prisma.notification.count({ where }),
      ])

      return {
        data: notifications,
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
    '/mark-read',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const body = markReadBodySchema.parse(request.body)
      const userId = uid(request)

      await fastify.prisma.notification.updateMany({
        where: body.all
          ? { userId, isRead: false }
          : { userId, id: { in: body.notificationIds! } },
        data: { isRead: true },
      })

      return { success: true }
    },
  )
}
