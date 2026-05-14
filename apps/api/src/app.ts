import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { config } from './config'
import prismaPlugin from './plugins/prisma'
import redisPlugin from './plugins/redis'
import supabasePlugin from './plugins/supabaseStorage'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import invoiceRoutes from './routes/invoices'
import grnRoutes from './routes/grn'
import grnSyncRoutes from './routes/grnSync'
import reconciliationRoutes from './routes/reconciliation'
import paymentsRoutes from './routes/payments'
import vendorsRoutes from './routes/vendors'
import usersRoutes from './routes/users'
import reportsRoutes from './routes/reports'

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: config.nodeEnv === 'development' ? true : (process.env.ALLOWED_ORIGINS?.split(',') ?? false),
  })

  await app.register(jwt, { secret: config.jwt.secret })

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  })

  await app.register(prismaPlugin)
  await app.register(redisPlugin)
  await app.register(supabasePlugin)

  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(invoiceRoutes, { prefix: '/invoices' })
  await app.register(grnRoutes)
  await app.register(grnSyncRoutes, { prefix: '/grn-sync' })
  await app.register(reconciliationRoutes, { prefix: '/reconciliation' })
  await app.register(paymentsRoutes, { prefix: '/payments' })
  await app.register(vendorsRoutes, { prefix: '/vendors' })
  await app.register(usersRoutes, { prefix: '/users' })
  await app.register(reportsRoutes, { prefix: '/reports' })

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  app.setErrorHandler(errorHandler)

  return app
}
