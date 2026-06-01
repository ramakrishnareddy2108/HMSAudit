import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { config } from '../config'

const BUCKET_NAME = 'invoices'

export default fp(async function supabasePlugin(fastify: FastifyInstance) {
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey)
  fastify.decorate('supabase', supabase)

  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) {
    fastify.log.error({ err: listError.message }, 'Failed to list storage buckets')
    return
  }

  const exists = buckets?.some((b) => b.name === BUCKET_NAME)
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      fileSizeLimit: 10 * 1024 * 1024,
    })
    if (createError) {
      fastify.log.error({ err: createError.message }, `Failed to create storage bucket '${BUCKET_NAME}'`)
    } else {
      fastify.log.info(`Storage bucket '${BUCKET_NAME}' created`)
    }
  }
})
