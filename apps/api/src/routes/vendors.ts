import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type User, InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { cacheService } from '../services/cacheService'
import { AUDIT_LOG_ENABLED } from '../constants'

function uid(request: FastifyRequest): string {
  return (request.user as User).id
}

const vendorIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const PHONE_RE = /^[6-9]\d{9}$/
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

const createVendorBodySchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z
    .string()
    .regex(PHONE_RE, 'Enter a valid 10-digit Indian mobile number (starts with 6–9)')
    .optional(),
  email: z.string().email('Invalid email format').optional(),
  gstNumber: z
    .string()
    .regex(GST_RE, 'Invalid GST number — must be 15 characters (e.g. 22ABCDE1234F1Z5)')
    .optional(),
  bankName: z.string().min(1).optional(),
  bankAccountNumber: z.string().min(1).optional(),
  bankIfscCode: z
    .string()
    .regex(IFSC_RE, 'Invalid IFSC code — must be 11 characters (e.g. HDFC0001234)')
    .optional(),
  bankAccountName: z.string().min(1).optional(),
  bankBranch: z.string().optional(),
})

const updateVendorBodySchema = createVendorBodySchema.partial().extend({
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  withLedgerSummary: z.coerce.boolean().optional(),
})

const openingBalanceBodySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  amount: z.coerce.number(),
  notes: z.string().optional(),
})

type CreateBody = z.infer<typeof createVendorBodySchema>
type UpdateBody = z.infer<typeof updateVendorBodySchema>

function bankGroupError(body: Partial<CreateBody>): string | null {
  const group = [body.bankName, body.bankAccountNumber, body.bankIfscCode, body.bankAccountName]
  const filled = group.filter((v) => v && v.trim()).length
  if (filled > 0 && filled < 4) {
    return 'Bank details are all-or-nothing: bankName, bankAccountNumber, bankIfscCode, and bankAccountName must all be provided or all left empty.'
  }
  return null
}

const BLOCKING_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.draft,
  InvoiceStatus.pending_review,
  InvoiceStatus.sent_back,
  InvoiceStatus.re_submitted,
  InvoiceStatus.approved,
]

export default async function vendorsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: { tags: ['Vendors'], summary: 'List vendors with pagination' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page, limit, search, isActive, withLedgerSummary } = listQuerySchema.parse(request.query)
      const hospitalId = request.user.activeHospitalId ?? 'global'

      const cacheKey = withLedgerSummary
        ? null
        : `vendors_${hospitalId}_p${page}_l${limit}_s${search ?? ''}_a${String(isActive ?? '')}`

      if (cacheKey) {
        const cached = cacheService.get(cacheKey)
        if (cached) {
          reply.header('Cache-Control', 'private, max-age=3600')
          return cached
        }
      }

      const skip = (page - 1) * limit

      const where: Prisma.VendorWhereInput = { isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { gstNumber: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (isActive !== undefined) {
        where.isActive = isActive
      }

      const [vendors, total] = await Promise.all([
        request.server.prisma.vendor.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          include: { _count: { select: { invoices: true } } },
        }),
        request.server.prisma.vendor.count({ where }),
      ])

      if (!withLedgerSummary) {
        const result = {
          data: vendors,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        }
        cacheService.set(cacheKey!, result)
        reply.header('Cache-Control', 'private, max-age=3600')
        return result
      }

      const vendorIds = vendors.map((v) => v.id)
      const pagination = { page, limit, total, totalPages: Math.ceil(total / limit) }

      if (vendorIds.length === 0) return { data: [], pagination }

      const [billedAgg, paidAgg, allPayments, allInvoiceDates, reconciledUnpaidGrns, pendingGrnsOnApproved] = await Promise.all([
        request.server.prisma.invoice.groupBy({
          by: ['vendorId'],
          where: {
            vendorId: { in: vendorIds },
            status: { in: ['approved', 'reconciled', 'paid'] },
            isDeleted: false,
          },
          _sum: { invoiceAmount: true },
        }),
        request.server.prisma.payment.groupBy({
          by: ['vendorId'],
          where: { vendorId: { in: vendorIds } },
          _sum: { totalAmount: true },
        }),
        request.server.prisma.payment.findMany({
          where: { vendorId: { in: vendorIds } },
          orderBy: { paymentDate: 'desc' },
          select: { vendorId: true, paymentDate: true },
        }),
        request.server.prisma.invoice.findMany({
          where: { vendorId: { in: vendorIds }, invoiceDate: { not: null } },
          orderBy: { invoiceDate: 'desc' },
          select: { vendorId: true, invoiceDate: true },
        }),
        // Vendors with reconciled/partial_paid GRNs that still have remaining balance — not cleared
        // Mirrors vendor ledger: status reconciled+partial_paid, sum(grnAmount - paidAmount) > 0
        request.server.prisma.grnEntry.findMany({
          where: {
            invoice: { vendorId: { in: vendorIds }, isDeleted: false },
            status: { in: ['reconciled', 'partial_paid'] },
          },
          select: {
            grnAmount: true,
            paidAmount: true,
            invoice: { select: { vendorId: true } },
          },
        }),
        // Vendors that have pending GRNs on approved invoices — not cleared
        request.server.prisma.grnEntry.findMany({
          where: {
            invoice: { vendorId: { in: vendorIds }, status: 'approved', isDeleted: false },
            status: 'pending',
            isDeleted: false,
          },
          select: { invoice: { select: { vendorId: true } } },
        }),
      ])

      const billedMap = new Map<string, number>()
      for (const b of billedAgg) {
        billedMap.set(b.vendorId, Number(b._sum.invoiceAmount ?? 0))
      }

      const paidMap = new Map<string, number>()
      for (const p of paidAgg) {
        paidMap.set(p.vendorId, Number(p._sum.totalAmount ?? 0))
      }

      const vendorsWithUnpaidRecon = new Set(
        reconciledUnpaidGrns
          .filter((g) => Number(g.grnAmount) > Number(g.paidAmount))
          .map((g) => g.invoice.vendorId),
      )
      const vendorsWithPendingGrns = new Set(pendingGrnsOnApproved.map((g) => g.invoice.vendorId))

      const lastPaymentMap = new Map<string, Date>()
      for (const p of allPayments) {
        if (!lastPaymentMap.has(p.vendorId)) lastPaymentMap.set(p.vendorId, p.paymentDate)
      }

      const lastInvoiceDateMap = new Map<string, Date>()
      for (const inv of allInvoiceDates) {
        if (!lastInvoiceDateMap.has(inv.vendorId) && inv.invoiceDate) {
          lastInvoiceDateMap.set(inv.vendorId, inv.invoiceDate)
        }
      }

      const augmented = vendors
        .map((v) => {
          const billed = billedMap.get(v.id) ?? 0
          const paid = paidMap.get(v.id) ?? 0
          const outstanding = Math.max(0, billed - paid)
          return {
            ...v,
            outstandingAmount: outstanding,
            isCleared: !vendorsWithUnpaidRecon.has(v.id) && !vendorsWithPendingGrns.has(v.id),
            lastPaymentDate: lastPaymentMap.get(v.id) ?? null,
            lastInvoiceDate: lastInvoiceDateMap.get(v.id) ?? null,
          }
        })
        .sort((a, b) => b.outstandingAmount - a.outstandingAmount)

      return { data: augmented, pagination }
    },
  )

  fastify.post(
    '/',
    {
      schema: { tags: ['Vendors'], summary: 'Create a new vendor' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createVendorBodySchema.parse(request.body)

      const bankErr = bankGroupError(body)
      if (bankErr) return reply.status(400).send({ error: bankErr })

      const existing = await request.server.prisma.vendor.findFirst({
        where: { name: { equals: body.name, mode: 'insensitive' }, isDeleted: false },
      })
      if (existing) {
        return reply.status(409).send({ error: 'Vendor already exists' })
      }

      const vendor = await request.server.prisma.vendor.create({
        data: body as unknown as Prisma.VendorUncheckedCreateInput,
      })

      if (AUDIT_LOG_ENABLED) {
        await request.server.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'CREATE',
            entityType: 'Vendor',
            entityId: vendor.id,
            newValue: body as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`vendors_${request.user.activeHospitalId ?? 'global'}`)
      return reply.status(201).send(vendor)
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags: ['Vendors'], summary: 'Get vendor by ID' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)

      const vendor = await request.server.prisma.vendor.findUnique({
        where: { id },
        include: { _count: { select: { invoices: true } } },
      })

      if (!vendor || vendor.isDeleted) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      return vendor
    },
  )

  fastify.put(
    '/:id',
    {
      schema: { tags: ['Vendors'], summary: 'Update vendor details' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)
      const body = updateVendorBodySchema.parse(request.body) as UpdateBody

      const existing = await request.server.prisma.vendor.findUnique({ where: { id } })
      if (!existing || existing.isDeleted) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      const bankErr = bankGroupError(body)
      if (bankErr) return reply.status(400).send({ error: bankErr })

      if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await request.server.prisma.vendor.findFirst({
          where: {
            name: { equals: body.name, mode: 'insensitive' },
            id: { not: id },
            isDeleted: false,
          },
        })
        if (duplicate) {
          return reply.status(409).send({ error: 'Vendor already exists' })
        }
      }

      const updated = await request.server.prisma.vendor.update({
        where: { id },
        data: body,
      })

      const isActivating = body.isActive === true && !existing.isActive
      const isDeactivating = body.isActive === false && existing.isActive
      const action = isActivating ? 'ACTIVATE' : isDeactivating ? 'DEACTIVATE' : 'UPDATE'

      if (AUDIT_LOG_ENABLED) {
        await request.server.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action,
            entityType: 'Vendor',
            entityId: id,
            oldValue: {
              name: existing.name,
              contactName: existing.contactName,
              phone: existing.phone,
              email: existing.email,
              gstNumber: existing.gstNumber,
              isActive: existing.isActive,
            } as unknown as Prisma.InputJsonValue,
            newValue: body as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`vendors_${request.user.activeHospitalId ?? 'global'}`)
      return updated
    },
  )

  fastify.delete(
    '/:id',
    {
      schema: { tags: ['Vendors'], summary: 'Delete vendor by ID' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)

      const existing = await request.server.prisma.vendor.findUnique({ where: { id } })
      if (!existing || existing.isDeleted) {
        return reply.status(404).send({ error: 'Vendor not found' })
      }

      const [activeInvoices, unpaidGrns] = await Promise.all([
        request.server.prisma.invoice.count({
          where: { vendorId: id, status: { in: BLOCKING_INVOICE_STATUSES } },
        }),
        request.server.prisma.grnEntry.count({
          where: { status: 'reconciled', invoice: { vendorId: id } },
        }),
      ])

      if (activeInvoices > 0 || unpaidGrns > 0) {
        return reply.status(409).send({
          error: 'Vendor cannot be deleted while blocking items exist.',
          blockers: { activeInvoices, unpaidGrns },
        })
      }

      await request.server.prisma.vendor.update({
        where: { id },
        data: { isDeleted: true, isActive: false },
      })

      if (AUDIT_LOG_ENABLED) {
        await request.server.prisma.auditLog.create({
          data: {
            userId: uid(request),
            action: 'DELETE',
            entityType: 'Vendor',
            entityId: id,
            oldValue: { name: existing.name, isActive: existing.isActive } as unknown as Prisma.InputJsonValue,
            newValue: { isDeleted: true } as unknown as Prisma.InputJsonValue,
            ipAddress: request.ip,
          },
        })
      }

      cacheService.deleteByPrefix(`vendors_${request.user.activeHospitalId ?? 'global'}`)
      return { success: true }
    },
  )

  // POST /vendors/:id/opening-balance
  fastify.post(
    '/:id/opening-balance',
    {
      schema: { tags: ['Vendors'], summary: 'Upsert vendor opening balance' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)
      const body = openingBalanceBodySchema.parse(request.body)
      const hospitalId = request.user.activeHospitalId
      if (!hospitalId) return reply.status(400).send({ error: 'No active hospital selected' })

      const vendor = await request.server.prisma.vendor.findFirst({
        where: { id, isDeleted: false },
      })
      if (!vendor) return reply.status(404).send({ error: 'Vendor not found' })

      const record = await request.server.prisma.vendorOpeningBalance.upsert({
        where: { vendorId_hospitalId: { vendorId: id, hospitalId } },
        update: {
          asOfDate: new Date(body.asOfDate),
          amount: body.amount,
          notes: body.notes ?? null,
        },
        create: {
          vendorId: id,
          hospitalId,
          asOfDate: new Date(body.asOfDate),
          amount: body.amount,
          notes: body.notes ?? null,
          createdBy: uid(request),
        },
      })

      return reply.status(200).send(record)
    },
  )

  // GET /vendors/:id/opening-balance
  fastify.get(
    '/:id/opening-balance',
    {
      schema: { tags: ['Vendors'], summary: 'Get vendor opening balance' },
      preHandler: [authenticate, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = vendorIdParamsSchema.parse(request.params)
      const hospitalId = request.user.activeHospitalId
      if (!hospitalId) return reply.status(400).send({ error: 'No active hospital selected' })

      const record = await request.server.prisma.vendorOpeningBalance.findUnique({
        where: { vendorId_hospitalId: { vendorId: id, hospitalId } },
      })

      return reply.send(record ?? null)
    },
  )
}
