import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Queue } from 'bullmq'
import { User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'
import { config } from '../config'
import {
  notifyNewReviewItem,
  notifyInvoiceApproved,
  notifyInvoiceSentBack,
} from '../services/notificationService'
import { ocrService, OcrResult } from '../services/ocrService'

// Module-level singleton — not created per request (hard rule #5)
const ocrQueue = new Queue('ocr-processing', {
  connection: {
    url: config.redis.url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
})
ocrQueue.on('error', (err: Error) => {
  console.error('OCR queue error:', err.message)
})

const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['draft', 'pending_review', 'sent_back', 're_submitted', 'approved', 'reconciled', 'paid'])
    .optional(),
  vendorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  billType: z.enum(['grn_bill', 'miscellaneous']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const invoiceMetaSchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().optional(),
  invoiceAmount: z.number().positive(),
  departmentId: z.string().uuid().optional(),
  billType: z.enum(['grn_bill', 'miscellaneous']),
  miscCategory: z.string().optional(),
  miscDescription: z.string().optional(),
})

const updateInvoiceMetaSchema = invoiceMetaSchema
  .partial()
  .extend({ changeReason: z.string().optional() })

const approveBodySchema = z.object({
  note: z.string().optional(),
})

const sendBackBodySchema = z.object({
  note: z.string().min(1),
})

const checkDuplicateQuerySchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
})

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const LOCKED_STATUSES = ['reconciled', 'paid'] as const

export default async function invoiceRoutes(fastify: FastifyInstance) {
  // GET /invoices/check-duplicate — registered BEFORE /:id
  fastify.get(
    '/check-duplicate',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = checkDuplicateQuerySchema.parse(request.query)

      const existing = await fastify.prisma.invoice.findFirst({
        where: {
          vendorId: query.vendorId,
          invoiceNumber: query.invoiceNumber,
          status: { not: 'draft' },
        },
        include: {
          vendor: { select: { id: true, name: true } },
          uploader: { select: { id: true, name: true } },
          _count: { select: { grnEntries: true } },
        },
      })

      if (!existing) {
        return { isDuplicate: false }
      }

      return {
        isDuplicate: true,
        existing: {
          id: existing.id,
          invoiceNumber: existing.invoiceNumber,
          vendorId: existing.vendorId,
          status: existing.status,
          vendorName: existing.vendor.name,
          uploadedBy: existing.uploader.name,
          createdAt: existing.createdAt,
          grnCount: existing._count.grnEntries,
        },
      }
    },
  )

  // GET /invoices
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = invoiceListQuerySchema.parse(request.query)
      const { page, limit, status, vendorId, departmentId, billType, dateFrom, dateTo, search } =
        query
      const skip = (page - 1) * limit

      const roleWhere =
        (request.user as User).role === 'role_1'
          ? { uploadedBy: (request.user as User).id }
          : {}

      const where = {
        ...roleWhere,
        ...(status ? { status } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(billType ? { billType } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
                { vendor: { name: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
      }

      const [invoices, total] = await Promise.all([
        fastify.prisma.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            vendor: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            uploader: { select: { id: true, name: true } },
            _count: { select: { grnEntries: true } },
          },
        }),
        fastify.prisma.invoice.count({ where }),
      ])

      return {
        data: invoices,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },
  )

  // POST /invoices — multipart upload
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let fileBuffer: Buffer | null = null
      let fileContentType = ''
      let fileExtension = 'jpg'
      let rawDataStr = ''

      try {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            if (!ALLOWED_MIME_TYPES.includes(part.mimetype)) {
              return reply.code(400).send({ error: `Unsupported file type: ${part.mimetype}` })
            }
            fileBuffer = await part.toBuffer()
            fileContentType = part.mimetype
            fileExtension = MIME_TO_EXT[part.mimetype] ?? 'bin'
          } else if (part.type === 'field' && part.fieldname === 'data') {
            rawDataStr = part.value as string
          }
        }
      } catch (err) {
        return reply.code(400).send({ error: 'Failed to parse multipart request' })
      }

      if (!fileBuffer) return reply.code(400).send({ error: 'File is required' })
      if (!rawDataStr) return reply.code(400).send({ error: 'Invoice metadata is required' })

      let meta: z.infer<typeof invoiceMetaSchema>
      try {
        meta = invoiceMetaSchema.parse(JSON.parse(rawDataStr))
      } catch {
        return reply.code(400).send({ error: 'Invalid invoice metadata' })
      }

      const {
        vendorId,
        invoiceNumber,
        invoiceDate,
        invoiceAmount,
        departmentId,
        billType,
        miscCategory,
        miscDescription,
      } = meta

      // Step 1 — Duplicate check
      const duplicate = await fastify.prisma.invoice.findFirst({
        where: { vendorId, invoiceNumber, status: { not: 'draft' } },
        include: {
          vendor: { select: { name: true } },
          uploader: { select: { name: true } },
          _count: { select: { grnEntries: true } },
        },
      })

      if (duplicate) {
        return reply.code(409).send({
          error: 'DUPLICATE_INVOICE',
          existing: {
            id: duplicate.id,
            invoiceNumber: duplicate.invoiceNumber,
            status: duplicate.status,
            vendorName: duplicate.vendor.name,
            uploadedBy: duplicate.uploader.name,
            grnCount: duplicate._count.grnEntries,
          },
        })
      }

      // Step 2 — Upload to Supabase Storage
      const userId = (request.user as User).id
      const filePath = `invoices/${userId}/${Date.now()}-${invoiceNumber}.${fileExtension}`

      try {
        const { error: uploadError } = await fastify.supabase.storage
          .from('invoices')
          .upload(filePath, fileBuffer, { contentType: fileContentType, upsert: false })

        if (uploadError) throw new Error('File upload failed: ' + uploadError.message)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File upload failed'
        return reply.code(500).send({ error: msg })
      }

      const { data: signedData, error: signedError } = await fastify.supabase.storage
        .from('invoices')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365)

      if (signedError || !signedData?.signedUrl) {
        return reply.code(500).send({ error: 'Failed to generate file URL' })
      }

      const signedUrl = signedData.signedUrl

      // Step 3 — Create invoice
      const invoice = await fastify.prisma.invoice.create({
        data: {
          vendorId,
          invoiceNumber,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
          invoiceAmount,
          departmentId: departmentId ?? null,
          billType,
          miscCategory: miscCategory ?? null,
          miscDescription: miscDescription ?? null,
          fileUrl: signedUrl,
          ocrStatus: 'pending',
          status: 'draft',
          uploadedBy: userId,
          currentVersionNo: 1,
        },
      })

      // Step 4 — Version 1
      await fastify.prisma.invoiceVersion.create({
        data: {
          invoiceId: invoice.id,
          versionNo: 1,
          fileUrl: signedUrl,
          invoiceAmount,
          statusAtChange: 'draft',
          changedBy: userId,
          changeReason: 'Initial upload',
        },
      })

      // Step 5 — Enqueue OCR
      await ocrQueue.add('extract', { invoiceId: invoice.id, fileUrl: signedUrl })

      // Step 6 — Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'invoice_created',
          entityType: 'invoice',
          entityId: invoice.id,
          newValue: { invoiceNumber, vendorId, invoiceAmount },
          ipAddress: request.ip,
        },
      })

      await notifyNewReviewItem(fastify.prisma, invoice.id)

      return reply.code(201).send({
        id: invoice.id,
        status: 'draft',
        ocrStatus: 'pending',
        message: 'Invoice uploaded. OCR processing started.',
      })
    },
  )

  // POST /invoices/ocr-preview
  fastify.post(
    '/ocr-preview',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as User).id
      let fileBuffer: Buffer | null = null
      let fileContentType = ''
      let fileExtension = 'jpg'

      try {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file') {
            if (!ALLOWED_MIME_TYPES.includes(part.mimetype)) {
              return reply.code(400).send({ error: `Unsupported file type: ${part.mimetype}` })
            }
            fileBuffer = await part.toBuffer()
            fileContentType = part.mimetype
            fileExtension = MIME_TO_EXT[part.mimetype] ?? 'bin'
          }
        }
      } catch {
        return reply.code(400).send({ error: 'Failed to parse multipart request' })
      }

      if (!fileBuffer) return reply.code(400).send({ error: 'File is required' })

      const filePath = `ocr-preview/${userId}/${Date.now()}.${fileExtension}`

      const { error: uploadError } = await fastify.supabase.storage
        .from('invoices')
        .upload(filePath, fileBuffer, { contentType: fileContentType, upsert: false })

      if (uploadError) {
        return reply.code(500).send({ error: 'File upload failed: ' + uploadError.message })
      }

      const { data: signedData, error: signedError } = await fastify.supabase.storage
        .from('invoices')
        .createSignedUrl(filePath, 3600)

      if (signedError || !signedData?.signedUrl) {
        return reply.code(500).send({ error: 'Failed to generate file URL' })
      }

      let ocrResult: OcrResult
      try {
        ocrResult = await ocrService.extractFromUrl(signedData.signedUrl)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'OCR extraction failed'
        return reply.code(500).send({ error: msg })
      }

      return {
        vendorName: ocrResult.vendorName,
        invoiceNumber: ocrResult.invoiceNumber,
        invoiceDate: ocrResult.invoiceDate,
        invoiceAmount: ocrResult.invoiceAmount,
        currency: ocrResult.currency,
        confidence: ocrResult.confidence,
        rawText: ocrResult.rawText,
        modelUsed: ocrResult.modelUsed,
      }
    },
  )

  // GET /invoices/:id
  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true, email: true, role: true } },
          reviewer: { select: { id: true, name: true, email: true, role: true } },
          grnEntries: true,
          versions: { orderBy: { versionNo: 'asc' } },
          _count: { select: { grnEntries: true } },
        },
      })

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' })
      }

      if (
        (request.user as User).role === 'role_1' &&
        invoice.uploadedBy !== (request.user as User).id
      ) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      return invoice
    },
  )

  // PUT /invoices/:id — price revision (multipart)
  fastify.put(
    '/:id',
    { preHandler: [authenticate, requireRole('role_1', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      if ((request.user as User).role === 'role_1' && invoice.uploadedBy !== userId) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      if (LOCKED_STATUSES.includes(invoice.status as (typeof LOCKED_STATUSES)[number])) {
        return reply.code(403).send({ error: 'Cannot edit a reconciled or paid invoice' })
      }

      let newFileUrl: string | null = null
      let rawDataStr = ''

      try {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            if (!ALLOWED_MIME_TYPES.includes(part.mimetype)) {
              return reply.code(400).send({ error: `Unsupported file type: ${part.mimetype}` })
            }
            const buf = await part.toBuffer()
            const ext = MIME_TO_EXT[part.mimetype] ?? 'bin'
            const filePath = `invoices/${userId}/${Date.now()}-rev-${invoice.invoiceNumber}.${ext}`

            const { error: uploadError } = await fastify.supabase.storage
              .from('invoices')
              .upload(filePath, buf, { contentType: part.mimetype, upsert: false })

            if (uploadError) throw new Error('File upload failed: ' + uploadError.message)

            const { data: signed, error: signedErr } = await fastify.supabase.storage
              .from('invoices')
              .createSignedUrl(filePath, 60 * 60 * 24 * 365)

            if (signedErr || !signed?.signedUrl) throw new Error('Failed to generate file URL')
            newFileUrl = signed.signedUrl
          } else if (part.type === 'field' && part.fieldname === 'data') {
            rawDataStr = part.value as string
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to process request'
        return reply.code(500).send({ error: msg })
      }

      let meta: z.infer<typeof updateInvoiceMetaSchema> = {}
      if (rawDataStr) {
        try {
          meta = updateInvoiceMetaSchema.parse(JSON.parse(rawDataStr))
        } catch {
          return reply.code(400).send({ error: 'Invalid invoice metadata' })
        }
      }

      const nextVersion = invoice.currentVersionNo + 1

      await fastify.prisma.invoiceVersion.create({
        data: {
          invoiceId: invoice.id,
          versionNo: nextVersion,
          fileUrl: newFileUrl ?? invoice.fileUrl,
          invoiceAmount: meta.invoiceAmount ?? Number(invoice.invoiceAmount),
          statusAtChange: invoice.status,
          changedBy: userId,
          changeReason: meta.changeReason ?? 'Price revision',
        },
      })

      const updated = await fastify.prisma.invoice.update({
        where: { id },
        data: {
          ...(newFileUrl ? { fileUrl: newFileUrl } : {}),
          ...(meta.invoiceAmount ? { invoiceAmount: meta.invoiceAmount } : {}),
          ...(meta.invoiceDate ? { invoiceDate: new Date(meta.invoiceDate) } : {}),
          ...(meta.departmentId !== undefined ? { departmentId: meta.departmentId } : {}),
          ...(meta.miscCategory !== undefined ? { miscCategory: meta.miscCategory } : {}),
          ...(meta.miscDescription !== undefined ? { miscDescription: meta.miscDescription } : {}),
          status: 'pending_review',
          isPriceRevised: true,
          currentVersionNo: { increment: 1 },
        },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true } },
        },
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'invoice_revised',
          entityType: 'invoice',
          entityId: invoice.id,
          newValue: { version: nextVersion, ...meta },
          ipAddress: request.ip,
        },
      })

      return updated
    },
  )

  // POST /invoices/:id/approve
  fastify.post(
    '/:id/approve',
    { preHandler: [authenticate, requireRole('role_2', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const body = approveBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: { grnEntries: true },
      })

      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      if (!['pending_review', 're_submitted'].includes(invoice.status)) {
        return reply.code(400).send({ error: 'Cannot approve invoice in current status' })
      }

      const grnTotal = invoice.grnEntries.reduce(
        (sum, g) => sum + Number(g.grnAmount),
        0,
      )
      const invoiceAmount = Number(invoice.invoiceAmount)

      if (grnTotal > invoiceAmount) {
        return reply.code(400).send({
          error: 'GRN_TOTAL_EXCEEDS_INVOICE',
          grnTotal,
          invoiceAmount,
        })
      }

      const updated = await fastify.prisma.invoice.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedBy: userId,
          reviewerNote: body.note ?? null,
          submittedAt: new Date(),
        },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true } },
          grnEntries: true,
        },
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'invoice_approved',
          entityType: 'invoice',
          entityId: invoice.id,
          newValue: { status: 'approved', note: body.note },
          ipAddress: request.ip,
        },
      })

      await notifyInvoiceApproved(fastify.prisma, invoice.id, invoice.uploadedBy)

      return updated
    },
  )

  // POST /invoices/:id/send-back
  fastify.post(
    '/:id/send-back',
    { preHandler: [authenticate, requireRole('role_2', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const { note } = sendBackBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      if (!['pending_review', 're_submitted'].includes(invoice.status)) {
        return reply.code(400).send({ error: 'Cannot send back invoice in current status' })
      }

      const updated = await fastify.prisma.invoice.update({
        where: { id },
        data: {
          status: 'sent_back',
          reviewerNote: note,
          reviewedBy: userId,
        },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true } },
        },
      })

      await fastify.prisma.auditLog.create({
        data: {
          userId,
          action: 'invoice_sent_back',
          entityType: 'invoice',
          entityId: invoice.id,
          newValue: { status: 'sent_back', note },
          ipAddress: request.ip,
        },
      })

      await notifyInvoiceSentBack(fastify.prisma, invoice.id, invoice.uploadedBy, note)

      return updated
    },
  )

  // GET /invoices/:id/versions
  fastify.get(
    '/:id/versions',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      if (
        (request.user as User).role === 'role_1' &&
        invoice.uploadedBy !== (request.user as User).id
      ) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      return fastify.prisma.invoiceVersion.findMany({
        where: { invoiceId: id },
        orderBy: { versionNo: 'asc' },
      })
    },
  )
}
