import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: Number(process.env.API_PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL!,
  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },
  redis: {
    url: process.env.REDIS_URL!,
  },
  google: {
    visionApiKey: process.env.GOOGLE_CLOUD_VISION_API_KEY!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY!,
  },
  jwt: {
    secret: process.env.JWT_SECRET!,
  },
}
