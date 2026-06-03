import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { tenantStorage, TENANT_MODELS } from '../middleware/tenancy'

type AnyRecord = Record<string, unknown>

const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set(['Invoice', 'GrnEntry'])

const SOFT_DELETE_READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

export default fp(async function prismaPlugin(fastify: FastifyInstance) {
  const base = new PrismaClient()

  const prisma = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const hospitalId = tenantStorage.getStore()

          console.log(`[Tenancy] ${model ?? '?'} ${operation} hospitalId: ${hospitalId ?? 'null'}`)

          const a = args as AnyRecord

          if (hospitalId && model && TENANT_MODELS.has(model)) {
            if (operation === 'create') {
              a['data'] = { ...(a['data'] as AnyRecord), hospitalId }
            } else if (operation === 'createMany' && Array.isArray(a['data'])) {
              a['data'] = (a['data'] as AnyRecord[]).map((d) => ({ ...d, hospitalId }))
            } else if (operation === 'upsert') {
              a['create'] = { ...(a['create'] as AnyRecord), hospitalId }
              a['where'] = { ...(a['where'] as AnyRecord), hospitalId }
            } else if (
              [
                'findFirst',
                'findFirstOrThrow',
                'findMany',
                'count',
                'aggregate',
                'groupBy',
                'update',
                'updateMany',
                'delete',
                'deleteMany',
              ].includes(operation)
            ) {
              a['where'] = { ...(a['where'] as AnyRecord), hospitalId }
            }
          }

          if (model && SOFT_DELETE_MODELS.has(model) && SOFT_DELETE_READ_OPS.has(operation)) {
            const where = (a['where'] as AnyRecord) ?? {}
            if (where['showDeleted']) {
              const { showDeleted: _sd, ...rest } = where
              a['where'] = rest
            } else {
              a['where'] = { ...where, isDeleted: false }
            }
          }

          return query(args)
        },
      },
    },
  })

  await base.$connect()
  fastify.decorate('prisma', prisma as unknown as PrismaClient)

  fastify.addHook('onClose', async () => {
    await base.$disconnect()
  })
})
