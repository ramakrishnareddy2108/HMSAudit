import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { config } from '../config'

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  request.log.error(error)

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'Validation error',
      details: error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const fields = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field'
      reply.status(409).send({ error: `Duplicate value for ${fields}` })
      return
    }
    if (error.code === 'P2025') {
      reply.status(404).send({ error: 'Record not found' })
      return
    }
  }

  const statusCode = error.statusCode ?? 500

  if (config.nodeEnv === 'development') {
    reply.status(statusCode).send({ error: error.message, stack: error.stack })
    return
  }

  reply
    .status(statusCode >= 500 ? 500 : statusCode)
    .send({ error: statusCode >= 500 ? 'Internal server error' : error.message })
}
