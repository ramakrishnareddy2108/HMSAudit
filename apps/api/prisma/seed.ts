import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DEPARTMENTS = [
  'Central Store',
  'General Store'
]

const SEED_USERS = [
  {
    email: 'admin@hospital.com',
    password: 'Admin@123456',
    name: 'System Admin',
    role: 'admin' as const,
  },
  {
    email: 'reviewer@hospital.com',
    password: 'Reviewer@123456',
    name: 'Priya Reviewer',
    role: 'role_2' as const,
  },
  {
    email: 'staff.cs@hospital.com',
    password: 'Staff@123456',
    name: 'Ravi Pharmacy',
    role: 'role_1' as const,
    department: 'Central Store',
  },
  {
    email: 'staff.gs@hospital.com',
    password: 'Staff@123456',
    name: 'Meena ICU',
    role: 'role_1' as const,
    department: 'General Store',
  },
]

async function createAuthUser(email: string, password: string) {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error && !error.message.toLowerCase().includes('already')) {
    throw new Error(`Supabase auth error for ${email}: ${error.message}`)
  }
}

async function main() {
  // Upsert departments first (users reference them)
  const deptMap: Record<string, string> = {}
  for (const name of DEPARTMENTS) {
    const dept = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    })
    deptMap[name] = dept.id
    console.log(`✅ Department '${name}' ready`)
  }

  // Create all seed users
  for (const u of SEED_USERS) {
    await createAuthUser(u.email, u.password)

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: true,
      },
    })

    if (u.department && deptMap[u.department]) {
      await prisma.userDepartment.upsert({
        where: { userId_departmentId: { userId: user.id, departmentId: deptMap[u.department] } },
        update: {},
        create: { userId: user.id, departmentId: deptMap[u.department] },
      })
    }

    console.log(`✅ User '${u.email}' (${u.role}) ready`)
  }

  console.log('\n📋 Test credentials:')
  for (const u of SEED_USERS) {
    console.log(`   ${u.role.padEnd(8)} ${u.email} / ${u.password}`)
  }

  console.log('\n✅ Seed complete')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
