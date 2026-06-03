import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import cron from 'node-cron'
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
import departmentRoutes from './routes/departments'
import notificationRoutes from './routes/notifications'
import superAdminRoutes from './routes/superAdmin'

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.WEB_URL || 'http://localhost:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hospital-Id'],
  })

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  })

  if (process.env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        openapi: '3.0.0',
        info: {
          title: 'HMS Invoice Tracker API',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    })

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    })
  }

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
  await app.register(departmentRoutes, { prefix: '/departments' })
  await app.register(notificationRoutes, { prefix: '/notifications' })
  await app.register(superAdminRoutes, { prefix: '/super' })

  app.get('/health', {
    schema: { tags: ['System'], summary: 'Health check' },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  app.setErrorHandler(errorHandler)

  cron.schedule('0 2 * * *', async () => {
    try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 90)
      const { count } = await app.prisma.notification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      })
      app.log.info(`Notification cleanup: deleted ${count} notifications older than 90 days`)
    } catch (err) {
      app.log.error({ err }, 'Notification cleanup cron failed')
    }
  })

  return app
}
