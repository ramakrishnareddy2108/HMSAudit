import { PrismaClient, User } from '@prisma/client'
import { Redis } from 'ioredis'
import { SupabaseClient } from '@supabase/supabase-js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
    redis: Redis
    supabase: SupabaseClient
  }

  interface FastifyRequest {
    user: User
  }
}
