import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { config } from '../config'

export default fp(async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  })

  redis.on('error', (err: Error) => fastify.log.error({ err: err.message }, 'Redis connection error'))
  redis.on('connect', () => fastify.log.info('Redis connected'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
})
