import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function errorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  request.log.error(error)

  if (error instanceof ZodError) {
    const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    reply.status(400).send({ success: false, error: 'Validation Error', message, statusCode: 400 })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped: Record<string, { code: number; msg: string }> = {
      P2002: { code: 409, msg: 'Record already exists' },
      P2025: { code: 404, msg: 'Record not found' },
      P2003: { code: 400, msg: 'Invalid reference' },
    }
    const entry = mapped[error.code]
    if (entry) {
      reply.status(entry.code).send({
        success: false,
        error: entry.msg,
        message: entry.msg,
        statusCode: entry.code,
      })
      return
    }
    reply.status(400).send({
      success: false,
      error: 'Database Error',
      message: 'Missing required data. Please try again.',
      statusCode: 400,
    })
    return
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    reply.status(400).send({
      success: false,
      error: 'Validation Error',
      message: 'Missing required data. Please try again.',
      statusCode: 400,
    })
    return
  }

  if (
    error.name === 'JsonWebTokenError' ||
    error.name === 'TokenExpiredError' ||
    error.name === 'NotBeforeError'
  ) {
    reply.status(401).send({
      success: false,
      error: 'Authentication Error',
      message: 'Session expired. Please login again.',
      statusCode: 401,
    })
    return
  }

  const statusCode = (error as { statusCode?: number }).statusCode ?? 500
  const isServer = statusCode >= 500

  reply.status(isServer ? 500 : statusCode).send({
    success: false,
    error: isServer ? 'Internal Server Error' : error.message,
    message: isServer ? 'Something went wrong. Please try again.' : error.message,
    statusCode: isServer ? 500 : statusCode,
  })
}
