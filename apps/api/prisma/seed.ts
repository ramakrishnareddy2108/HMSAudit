import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function createAuthUser(email: string, password: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error && !error.message.toLowerCase().includes('already')) {
    throw new Error(`Supabase auth error for ${email}: ${error.message}`)
  }
  if (data?.user?.id) return data.user.id
  // If user already existed, look up their ID
  const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  return listData?.users?.find((u) => u.email === email)?.id ?? null
}

async function main() {
  // ── Hospitals ──────────────────────────────────────────────────────────────
  const cityHospital = await prisma.hospital.upsert({
    where: { name: 'City Hospital' },
    update: {},
    create: { name: 'City Hospital', isActive: true },
  })
  console.log(`✅ Hospital '${cityHospital.name}' ready`)

  const generalHospital = await prisma.hospital.upsert({
    where: { name: 'General Hospital' },
    update: {},
    create: { name: 'General Hospital', isActive: true },
  })
  console.log(`✅ Hospital '${generalHospital.name}' ready`)

  // ── Departments — City Hospital ────────────────────────────────────────────
  const cityDeptNames = ['General Store', 'Central Store']
  const cityDeptMap: Record<string, string> = {}
  for (const name of cityDeptNames) {
    let dept = await prisma.department.findFirst({
      where: { hospitalId: cityHospital.id, name, isDeleted: false },
    })
    if (!dept) {
      dept = await prisma.department.create({
        data: { hospitalId: cityHospital.id, name },
      })
    }
    cityDeptMap[name] = dept.id
    console.log(`✅ Department '${name}' (City Hospital) ready`)
  }

  // ── Departments — General Hospital ────────────────────────────────────────
  const generalDeptNames = ['General Store', 'Central Store']
  for (const name of generalDeptNames) {
    const existing = await prisma.department.findFirst({
      where: { hospitalId: generalHospital.id, name, isDeleted: false },
    })
    if (!existing) {
      await prisma.department.create({ data: { hospitalId: generalHospital.id, name } })
    }
    console.log(`✅ Department '${name}' (General Hospital) ready`)
  }

  // ── Super Admin ────────────────────────────────────────────────────────────
  const superAdminSid = await createAuthUser('superadmin@hms.com', 'SuperAdmin@123')
  await prisma.user.upsert({
    where: { email: 'superadmin@hms.com' },
    update: { supabaseId: superAdminSid ?? undefined },
    create: {
      email: 'superadmin@hms.com',
      name: 'Super Admin',
      role: 'admin',
      isSuperAdmin: true,
      hospitalId: null,
      isActive: true,
      supabaseId: superAdminSid ?? undefined,
    },
  })
  console.log('✅ Super admin ready')

  // ── City Hospital Admin ────────────────────────────────────────────────────
  const cityAdminSid = await createAuthUser('admin@cityhospital.com', 'Admin@123456')
  await prisma.user.upsert({
    where: { email: 'admin@cityhospital.com' },
    update: { supabaseId: cityAdminSid ?? undefined },
    create: {
      email: 'admin@cityhospital.com',
      name: 'City Hospital Admin',
      role: 'admin',
      isSuperAdmin: false,
      hospitalId: cityHospital.id,
      isActive: true,
      supabaseId: cityAdminSid ?? undefined,
    },
  })
  console.log('✅ City Hospital admin ready')

  // ── General Hospital Admin ─────────────────────────────────────────────────
  const generalAdminSid = await createAuthUser('admin@generalhospital.com', 'Admin@123456')
  await prisma.user.upsert({
    where: { email: 'admin@generalhospital.com' },
    update: { supabaseId: generalAdminSid ?? undefined },
    create: {
      email: 'admin@generalhospital.com',
      name: 'General Hospital Admin',
      role: 'admin',
      isSuperAdmin: false,
      hospitalId: generalHospital.id,
      isActive: true,
      supabaseId: generalAdminSid ?? undefined,
    },
  })
  console.log('✅ General Hospital admin ready')

  // ── City Hospital Reviewer ─────────────────────────────────────────────────
  const reviewerSid = await createAuthUser('reviewer@cityhospital.com', 'Reviewer@123456')
  await prisma.user.upsert({
    where: { email: 'reviewer@cityhospital.com' },
    update: { supabaseId: reviewerSid ?? undefined },
    create: {
      email: 'reviewer@cityhospital.com',
      name: 'Priya Reviewer',
      role: 'role_2',
      isSuperAdmin: false,
      hospitalId: cityHospital.id,
      isActive: true,
      supabaseId: reviewerSid ?? undefined,
    },
  })
  console.log('✅ City Hospital reviewer ready')

  // ── City Hospital Staff ────────────────────────────────────────────────────
  const staffPharmacySid = await createAuthUser('staff.pharmacy@cityhospital.com', 'Staff@123456')
  const staffPharmacy = await prisma.user.upsert({
    where: { email: 'staff.pharmacy@cityhospital.com' },
    update: { supabaseId: staffPharmacySid ?? undefined },
    create: {
      email: 'staff.pharmacy@cityhospital.com',
      name: 'Ravi Pharmacy',
      role: 'role_1',
      isSuperAdmin: false,
      hospitalId: cityHospital.id,
      isActive: true,
      supabaseId: staffPharmacySid ?? undefined,
    },
  })
  await prisma.userDepartment.upsert({
    where: {
      userId_departmentId: {
        userId: staffPharmacy.id,
        departmentId: cityDeptMap['General Store'],
      },
    },
    update: {},
    create: { userId: staffPharmacy.id, departmentId: cityDeptMap['General Store'] },
  })
  console.log('✅ City Hospital staff (General Store) ready')

  const staffIcuSid = await createAuthUser('staff.icu@cityhospital.com', 'Staff@123456')
  const staffIcu = await prisma.user.upsert({
    where: { email: 'staff.icu@cityhospital.com' },
    update: { supabaseId: staffIcuSid ?? undefined },
    create: {
      email: 'staff.icu@cityhospital.com',
      name: 'Meena Central',
      role: 'role_1',
      isSuperAdmin: false,
      hospitalId: cityHospital.id,
      isActive: true,
      supabaseId: staffIcuSid ?? undefined,
    },
  })
  await prisma.userDepartment.upsert({
    where: {
      userId_departmentId: {
        userId: staffIcu.id,
        departmentId: cityDeptMap['Central Store'],
      },
    },
    update: {},
    create: { userId: staffIcu.id, departmentId: cityDeptMap['Central Store'] },
  })
  console.log('✅ City Hospital staff (Central Store) ready')

  // ── Vendors — City Hospital ────────────────────────────────────────────────
  const cityVendors = [
    { name: 'MedSupply Co', contactName: 'Arjun Patel', phone: '9876543210', email: 'arjun@medsupply.com' },
    { name: 'Pharma Plus', contactName: 'Sunita Rao', phone: '9765432109', email: 'sunita@pharmaplus.com' },
    { name: 'HealthCare Distributors', contactName: 'Vijay Kumar', phone: '9654321098', email: 'vijay@hcd.com' },
    { name: 'Surgical World', contactName: 'Rekha Nair', phone: '9543210987', email: 'rekha@surgicalworld.com' },
    { name: 'Bio Medical Supplies', contactName: 'Suresh Menon', phone: '9432109876', email: 'suresh@biomedical.com' },
  ]
  for (const v of cityVendors) {
    const existing = await prisma.vendor.findFirst({
      where: { hospitalId: cityHospital.id, name: v.name, isDeleted: false },
    })
    if (!existing) {
      await prisma.vendor.create({ data: { ...v, hospitalId: cityHospital.id } })
    }
    console.log(`✅ Vendor '${v.name}' (City Hospital) ready`)
  }

  // ── Vendors — General Hospital ─────────────────────────────────────────────
  const generalVendors = [
    { name: 'General Med Supplies', contactName: 'Kiran Sharma', phone: '9321098765', email: 'kiran@genmed.com' },
    { name: 'OPD Pharmacy', contactName: 'Deepa Pillai', phone: '9210987654', email: 'deepa@opdpharma.com' },
    { name: 'Surgery Essentials', contactName: 'Mohan Das', phone: '9109876543', email: 'mohan@surgesse.com' },
  ]
  for (const v of generalVendors) {
    const existing = await prisma.vendor.findFirst({
      where: { hospitalId: generalHospital.id, name: v.name, isDeleted: false },
    })
    if (!existing) {
      await prisma.vendor.create({ data: { ...v, hospitalId: generalHospital.id } })
    }
    console.log(`✅ Vendor '${v.name}' (General Hospital) ready`)
  }

  console.log('\n📋 Seed credentials:')
  console.log('   SUPER ADMIN  superadmin@hms.com / SuperAdmin@123')
  console.log('   CITY ADMIN   admin@cityhospital.com / Admin@123456')
  console.log('   GEN ADMIN    admin@generalhospital.com / Admin@123456')
  console.log('   REVIEWER     reviewer@cityhospital.com / Reviewer@123456')
  console.log('   STAFF        staff.pharmacy@cityhospital.com / Staff@123456')
  console.log('   STAFF        staff.icu@cityhospital.com / Staff@123456')
  console.log('\n✅ Seed complete')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
