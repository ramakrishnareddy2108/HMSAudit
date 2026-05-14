import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { config } from '../config'

export default fp(async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(config.redis.url)

  redis.on('error', (err) => fastify.log.error(err, 'Redis connection error'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
})
