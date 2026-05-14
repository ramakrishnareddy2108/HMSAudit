import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { config } from '../config'

export default fp(async function supabasePlugin(fastify: FastifyInstance) {
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey)
  fastify.decorate('supabase', supabase)
})
