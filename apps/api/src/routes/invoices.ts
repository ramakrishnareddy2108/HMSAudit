import crypto from 'crypto'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma, User } from '@prisma/client'
import { authenticate, requireRole } from '../middleware/auth'
import {
  notifyNewReviewItem,
  notifyInvoiceApproved,
  notifyInvoiceSentBack,
} from '../services/notificationService'
import { ocrService, OcrResult } from '../services/ocrService'
import { storageService } from '../services/storageService'
import { AUDIT_LOG_ENABLED } from '../constants'

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
  showDeleted: z.coerce.boolean().default(false),
  deletedOnly: z.coerce.boolean().default(false),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const grnItemSchema = z.object({
  grnNumber: z.string().min(1),
  grnAmount: z.number().positive(),
  grnDate: z.string().optional(),
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
  grns: z.array(grnItemSchema).optional(),
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

// ── Version diff helpers ──────────────────────────────────────────────────────

interface GrnSnapshotItem {
  grnNumber: string
  grnAmount: string
  grnDate: string | null
}

interface InvoiceChangeItem {
  field: string
  oldValue: string
  newValue: string
}

interface GrnChangeItem {
  grnNumber: string
  changeType: 'added' | 'removed' | 'updated'
  field?: string
  oldValue?: string
  newValue?: string
}

interface VersionChangeSummary {
  invoiceChanges: InvoiceChangeItem[]
  grnChanges: GrnChangeItem[]
}

function fmtVersionAmount(n: number): string {
  return '₹' + new Intl.NumberFormat('en-IN').format(n)
}

function fmtVersionDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function invoiceRoutes(fastify: FastifyInstance) {
  // GET /invoices/check-duplicate — registered BEFORE /:id
  fastify.get(
    '/check-duplicate',
    {
      schema: { tags: ['Invoices'], summary: 'Check for duplicate invoice' },
      preHandler: [authenticate],
    },
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
    {
      schema: { tags: ['Invoices'], summary: 'List invoices with filters' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = invoiceListQuerySchema.parse(request.query)
      const {
        page,
        limit,
        status,
        vendorId,
        departmentId,
        billType,
        dateFrom,
        dateTo,
        search,
        showDeleted,
        deletedOnly,
      } = query
      const skip = (page - 1) * limit

      const user = request.user as User & { isSuperAdmin: boolean }
      const isAdmin = user.role === 'admin' || user.isSuperAdmin

      const roleWhere = user.role === 'role_1' ? { uploadedBy: user.id } : {}

      const softDeleteWhere = showDeleted && isAdmin
        ? { showDeleted: true, ...(deletedOnly ? { isDeleted: true } : {}) }
        : {}

      const where = {
        ...roleWhere,
        ...softDeleteWhere,
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
          where: where as Prisma.InvoiceWhereInput,
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
        fastify.prisma.invoice.count({ where: where as Prisma.InvoiceWhereInput }),
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
    {
      schema: { tags: ['Invoices'], summary: 'Upload invoice with file' },
      preHandler: [authenticate, requireRole('role_1', 'admin')],
    },
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

      // Step 1 — Duplicate check (invoice)
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

      // Step 1b — GRN duplicate check (upfront, before file upload)
      if (meta.grns && meta.grns.length > 0 && meta.billType === 'grn_bill') {
        const dupGrn = await fastify.prisma.grnEntry.findFirst({
          where: { grnNumber: { in: meta.grns.map((g) => g.grnNumber) } },
        })
        if (dupGrn) {
          return reply.code(409).send({ error: 'GRN_DUPLICATE', grnNumber: dupGrn.grnNumber })
        }
      }

      // Step 2 — Upload to R2
      const userId = (request.user as User).id
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')

      let filePath: string
      try {
        const result = await storageService.uploadFile({
          buffer: fileBuffer,
          filename: `${invoiceNumber}.${fileExtension}`,
          mimetype: fileContentType,
          folder: `invoices/${userId}`,
        })
        filePath = result.path
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File upload failed'
        return reply.code(500).send({ error: msg })
      }

      // Step 3 — Check for duplicate file hash (same hospital, OCR already done)
      const hashMatch = await fastify.prisma.invoice.findFirst({
        where: { fileHash, ocrStatus: 'done' },
        select: { ocrRawText: true, ocrExtractedJson: true, ocrModelUsed: true },
      })

      // Step 4 — Create invoice with pending_review status
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
          fileUrl: filePath,
          fileHash,
          ocrStatus: 'pending',
          status: 'pending_review',
          uploadedBy: userId,
          currentVersionNo: 1,
        } as unknown as Prisma.InvoiceUncheckedCreateInput,
      })

      // Step 5 — Create GRNs if provided + build grnSnapshot
      let initialGrnSnapshot: GrnSnapshotItem[] = []
      if (meta.grns && meta.grns.length > 0 && meta.billType === 'grn_bill') {
        const createdGrns = await Promise.all(
          meta.grns.map((g) =>
            fastify.prisma.grnEntry.create({
              data: {
                invoiceId: invoice.id,
                grnNumber: g.grnNumber,
                grnAmount: g.grnAmount,
                grnDate: g.grnDate ? new Date(g.grnDate) : null,
              } as unknown as Prisma.GrnEntryUncheckedCreateInput,
            }),
          ),
        )
        initialGrnSnapshot = createdGrns.map((g) => ({
          grnNumber: g.grnNumber,
          grnAmount: g.grnAmount.toString(),
          grnDate: g.grnDate ? g.grnDate.toISOString() : null,
        }))
      }

      // Step 6 — Version 1
      await fastify.prisma.invoiceVersion.create({
        data: {
          invoiceId: invoice.id,
          versionNo: 1,
          fileUrl: filePath,
          invoiceAmount,
          statusAtChange: 'pending_review',
          changedBy: userId,
          changeReason: 'Initial upload',
          grnSnapshot: initialGrnSnapshot as unknown as Prisma.InputJsonValue,
        },
      })

      // Step 6 — OCR (synchronous, non-fatal)
      try {
        let ocrUpdate: Record<string, unknown>

        if (hashMatch) {
          console.log(`[OCR] Skipped — duplicate hash, reusing cached result for: ${invoiceNumber}`)
          ocrUpdate = {
            ocrStatus: 'done',
            ocrRawText: hashMatch.ocrRawText ?? null,
            ocrExtractedJson: hashMatch.ocrExtractedJson ?? null,
            ocrModelUsed: hashMatch.ocrModelUsed ?? null,
            ocrProcessedAt: new Date(),
          }
        } else {
          const ocrUrl = await storageService.getPresignedUrl(filePath, 3600)
          const result = await ocrService.extractFromUrl(ocrUrl, invoiceNumber)

          if (result.failed) {
            ocrUpdate = { ocrStatus: 'failed' }
          } else {
            ocrUpdate = {
              ocrStatus: 'done',
              ocrRawText: result.rawText || null,
              ocrExtractedJson: {
                vendorName: result.vendorName,
                invoiceNumber: result.invoiceNumber,
                invoiceDate: result.invoiceDate,
                invoiceAmount: result.invoiceAmount,
                currency: result.currency,
                confidence: result.confidence,
              },
              ocrModelUsed: result.modelUsed,
              ocrProcessedAt: new Date(),
            }
          }
        }

        await fastify.prisma.invoice.update({
          where: { id: invoice.id },
          data: ocrUpdate as Prisma.InvoiceUpdateInput,
        })
      } catch (err) {
        console.error('[OCR] Unexpected error during sync OCR — invoice still created:', err)
        await fastify.prisma.invoice.update({
          where: { id: invoice.id },
          data: { ocrStatus: 'failed' },
        })
      }

      // Step 7 — Audit log
      if (AUDIT_LOG_ENABLED) {
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
      }

      await notifyNewReviewItem(fastify.prisma, invoice.id)

      return reply.code(201).send({
        id: invoice.id,
        status: 'pending_review',
        message: 'Invoice uploaded successfully.',
      })
    },
  )

  // POST /invoices/ocr-preview
  fastify.post(
    '/ocr-preview',
    {
      schema: { tags: ['Invoices'], summary: 'Extract data from invoice file' },
      preHandler: [authenticate, requireRole('role_1', 'admin')],
    },
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

      let tempPath: string
      let presignedUrl: string
      try {
        console.log('[OCR] Starting file upload...')
        const result = await storageService.uploadFile({
          buffer: fileBuffer,
          filename: `preview.${fileExtension}`,
          mimetype: fileContentType,
          folder: `ocr-preview/${userId}`,
        })
        tempPath = result.path
        presignedUrl = await storageService.getPresignedUrl(tempPath, 3600)
        console.log('[OCR] File uploaded, starting Vision API call...')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File upload failed'
        return reply.code(500).send({ error: msg })
      }

      let ocrResult: OcrResult
      try {
        ocrResult = await ocrService.extractFromUrl(presignedUrl)
        console.log('[OCR] Vision API response received...')
      } catch {
        ocrResult = {
          vendorName: null,
          invoiceNumber: null,
          invoiceDate: null,
          invoiceAmount: null,
          currency: null,
          confidence: { vendorName: 0, invoiceNumber: 0, invoiceDate: 0, invoiceAmount: 0 },
          rawText: '',
          modelUsed: 'none',
          failed: true,
        }
      }

      try {
        await storageService.deleteFile(tempPath)
      } catch {
        // non-fatal
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
    {
      schema: { tags: ['Invoices'], summary: 'Get invoice details by ID' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const user = request.user as User & { isSuperAdmin: boolean }
      const isAdmin = user.role === 'admin' || user.isSuperAdmin

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true, email: true, role: true } },
          reviewer: { select: { id: true, name: true, email: true, role: true } },
          grnEntries: true,
          versions: {
            orderBy: { versionNo: 'asc' },
            include: { changedByUser: { select: { id: true, name: true } } },
          },
          _count: { select: { grnEntries: true } },
        },
      })

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' })
      }

      if (invoice.isDeleted && !isAdmin) {
        return reply.code(404).send({ error: 'Invoice not found' })
      }

      if (user.role === 'role_1' && invoice.uploadedBy !== user.id) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      let presignedUrl: string | null = null
      let fileType: 'image' | 'pdf' | null = null
      if (invoice.fileUrl) {
        const ext = invoice.fileUrl.split('.').pop()?.toLowerCase()
        fileType = ext && ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'pdf'
        presignedUrl = await storageService.getPresignedUrl(invoice.fileUrl)
      }

      return { ...invoice, fileUrl: presignedUrl, fileType }
    },
  )

  // PUT /invoices/:id — price revision (multipart)
  fastify.put(
    '/:id',
    {
      schema: { tags: ['Invoices'], summary: 'Revise invoice price' },
      preHandler: [authenticate, requireRole('role_1', 'admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })
      if (invoice.isDeleted) return reply.code(404).send({ error: 'Invoice not found' })

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
            const result = await storageService.uploadFile({
              buffer: buf,
              filename: `rev-${invoice.invoiceNumber}.${ext}`,
              mimetype: part.mimetype,
              folder: `invoices/${userId}`,
            })
            newFileUrl = result.path
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

      const currentAmount = Number(invoice.invoiceAmount)
      const incomingAmount = meta.invoiceAmount !== undefined ? meta.invoiceAmount : currentAmount
      const amountChanged = Math.abs(incomingAmount - currentAmount) > 0.01

      const nextVersion = invoice.currentVersionNo + 1

      // Compute changeSummary + grnSnapshot
      const currentGrns = await fastify.prisma.grnEntry.findMany({ where: { invoiceId: id } })
      const prevVersion = await fastify.prisma.invoiceVersion.findFirst({
        where: { invoiceId: id, versionNo: invoice.currentVersionNo },
      })
      const prevGrns = prevVersion?.grnSnapshot
        ? (prevVersion.grnSnapshot as unknown as GrnSnapshotItem[])
        : null

      const invoiceChanges: InvoiceChangeItem[] = []

      if (amountChanged) {
        invoiceChanges.push({
          field: 'invoiceAmount',
          oldValue: fmtVersionAmount(currentAmount),
          newValue: fmtVersionAmount(incomingAmount),
        })
      }

      if (meta.invoiceDate !== undefined) {
        const oldDate = invoice.invoiceDate ? fmtVersionDate(invoice.invoiceDate) : null
        const newDate = meta.invoiceDate ? fmtVersionDate(new Date(meta.invoiceDate)) : null
        if (oldDate !== newDate) {
          invoiceChanges.push({
            field: 'invoiceDate',
            oldValue: oldDate ?? '—',
            newValue: newDate ?? '—',
          })
        }
      }

      if (newFileUrl) {
        invoiceChanges.push({ field: 'fileUrl', oldValue: 'Previous file', newValue: 'New file uploaded' })
      }

      const grnChanges: GrnChangeItem[] = []

      if (prevGrns !== null) {
        const prevMap = new Map(prevGrns.map((g) => [g.grnNumber, g]))
        const currMap = new Map(currentGrns.map((g) => [g.grnNumber, g]))

        for (const [grnNumber, grn] of currMap) {
          if (!prevMap.has(grnNumber)) {
            grnChanges.push({
              grnNumber,
              changeType: 'added',
              newValue: `${fmtVersionAmount(Number(grn.grnAmount))}${grn.grnDate ? ` on ${fmtVersionDate(grn.grnDate)}` : ''}`,
            })
          }
        }

        for (const grnNumber of prevMap.keys()) {
          if (!currMap.has(grnNumber)) {
            grnChanges.push({ grnNumber, changeType: 'removed' })
          }
        }

        for (const [grnNumber, prev] of prevMap) {
          const curr = currMap.get(grnNumber)
          if (!curr) continue

          if (Math.abs(Number(curr.grnAmount) - Number(prev.grnAmount)) > 0.01) {
            grnChanges.push({
              grnNumber,
              changeType: 'updated',
              field: 'grnAmount',
              oldValue: fmtVersionAmount(Number(prev.grnAmount)),
              newValue: fmtVersionAmount(Number(curr.grnAmount)),
            })
          }

          const prevDateMs = prev.grnDate ? new Date(prev.grnDate).setHours(0, 0, 0, 0) : null
          const currDateMs = curr.grnDate ? curr.grnDate.setHours(0, 0, 0, 0) : null
          if (prevDateMs !== currDateMs) {
            grnChanges.push({
              grnNumber,
              changeType: 'updated',
              field: 'grnDate',
              oldValue: prev.grnDate ? fmtVersionDate(new Date(prev.grnDate)) : '—',
              newValue: curr.grnDate ? fmtVersionDate(curr.grnDate) : '—',
            })
          }
        }
      }

      const changeSummary: VersionChangeSummary = { invoiceChanges, grnChanges }
      const newGrnSnapshot: GrnSnapshotItem[] = currentGrns.map((g) => ({
        grnNumber: g.grnNumber,
        grnAmount: g.grnAmount.toString(),
        grnDate: g.grnDate ? g.grnDate.toISOString() : null,
      }))

      await fastify.prisma.invoiceVersion.create({
        data: {
          invoiceId: invoice.id,
          versionNo: nextVersion,
          fileUrl: newFileUrl ?? invoice.fileUrl,
          invoiceAmount: meta.invoiceAmount ?? currentAmount,
          statusAtChange: invoice.status,
          changedBy: userId,
          changeReason: meta.changeReason ?? (amountChanged ? 'Price revision' : 'Invoice correction'),
          changeSummary: changeSummary as unknown as Prisma.InputJsonValue,
          grnSnapshot: newGrnSnapshot as unknown as Prisma.InputJsonValue,
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
          ...(amountChanged ? { isPriceRevised: true } : {}),
          currentVersionNo: { increment: 1 },
        },
        include: {
          vendor: true,
          uploader: { select: { id: true, name: true } },
        },
      })

      if (AUDIT_LOG_ENABLED) {
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
      }

      return updated
    },
  )

  // POST /invoices/:id/approve
  fastify.post(
    '/:id/approve',
    {
      schema: { tags: ['Invoices'], summary: 'Approve invoice for reconciliation' },
      preHandler: [authenticate, requireRole('role_2', 'admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const body = approveBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: { grnEntries: true },
      })

      if (!invoice || invoice.isDeleted) return reply.code(404).send({ error: 'Invoice not found' })

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

      if (AUDIT_LOG_ENABLED) {
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
      }

      await notifyInvoiceApproved(fastify.prisma, invoice.id, invoice.uploadedBy)

      return updated
    },
  )

  // POST /invoices/:id/send-back
  fastify.post(
    '/:id/send-back',
    {
      schema: { tags: ['Invoices'], summary: 'Send invoice back to uploader' },
      preHandler: [authenticate, requireRole('role_2', 'admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const { note } = sendBackBodySchema.parse(request.body)
      const userId = (request.user as User).id

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice || invoice.isDeleted) return reply.code(404).send({ error: 'Invoice not found' })

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

      if (AUDIT_LOG_ENABLED) {
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
      }

      await notifyInvoiceSentBack(fastify.prisma, invoice.id, invoice.uploadedBy, note)

      return updated
    },
  )

  // DELETE /invoices/:id — soft delete
  fastify.delete(
    '/:id',
    {
      schema: { tags: ['Invoices'], summary: 'Soft delete invoice' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)
      const user = request.user as User & { isSuperAdmin: boolean }
      const userId = user.id
      const isAdmin = user.role === 'admin' || user.isSuperAdmin

      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: { grnEntries: true },
      })

      if (!invoice || invoice.isDeleted) return reply.code(404).send({ error: 'Invoice not found' })

      if (user.role === 'role_1') {
        if (invoice.uploadedBy !== userId) {
          return reply.code(403).send({ error: 'Access denied' })
        }
        const hasLockedGrn = invoice.grnEntries.some(
          (g) => g.status === 'reconciled' || g.status === 'paid',
        )
        if (hasLockedGrn) {
          return reply.code(400).send({
            error: 'Invoice has reconciled or paid GRNs and cannot be deleted',
          })
        }
      } else if (!isAdmin) {
        return reply.code(403).send({ error: 'Access denied' })
      } else {
        const hasPaidGrn = invoice.grnEntries.some((g) => g.status === 'paid')
        if (hasPaidGrn) {
          return reply.code(400).send({
            error: 'Invoice has paid GRNs. Payment records must be preserved.',
          })
        }
      }

      const now = new Date()

      await fastify.prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: {
            isDeleted: true,
            deletedAt: now,
            deletedBy: userId,
          },
        })
        await tx.grnEntry.updateMany({
          where: { invoiceId: id, status: 'pending', isDeleted: false },
          data: { isDeleted: true },
        })
      })

      if (AUDIT_LOG_ENABLED) {
        await fastify.prisma.auditLog.create({
          data: {
            userId,
            action: 'invoice_deleted',
            entityType: 'invoice',
            entityId: id,
            newValue: { isDeleted: true, deletedAt: now },
            ipAddress: request.ip,
          },
        })
      }

      return { success: true, deletedAt: now }
    },
  )

  // GET /invoices/:id/versions
  fastify.get(
    '/:id/versions',
    {
      schema: { tags: ['Invoices'], summary: 'List invoice version history' },
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamsSchema.parse(request.params)

      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } })
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' })

      const versionUser = request.user as User & { isSuperAdmin: boolean }
      const isAdminForVersions = versionUser.role === 'admin' || versionUser.isSuperAdmin
      if (invoice.isDeleted && !isAdminForVersions) {
        return reply.code(404).send({ error: 'Invoice not found' })
      }

      if (
        versionUser.role === 'role_1' &&
        invoice.uploadedBy !== versionUser.id
      ) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      const versions = await fastify.prisma.invoiceVersion.findMany({
        where: { invoiceId: id },
        orderBy: { versionNo: 'asc' },
        include: { changedByUser: { select: { id: true, name: true } } },
      })

      return Promise.all(
        versions.map(async (v) => {
          if (!v.fileUrl) return v
          const url = await storageService.getPresignedUrl(v.fileUrl)
          return { ...v, fileUrl: url }
        }),
      )
    },
  )
}
