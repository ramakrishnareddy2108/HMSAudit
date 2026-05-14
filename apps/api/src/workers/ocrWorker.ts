import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { ocrService } from '../services/ocrService'
import { config } from '../config'

interface OcrJobData {
  invoiceId: string
  fileUrl: string
}

const prisma = new PrismaClient()

export const ocrWorker = new Worker<OcrJobData>(
  'ocr-processing',
  async (job: Job<OcrJobData>) => {
    const { invoiceId, fileUrl } = job.data

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { ocrStatus: 'processing' },
    })

    try {
      const result = await ocrService.extractFromUrl(fileUrl)

      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          ocrStatus: 'done',
          ocrRawText: result.rawText,
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
        },
      })
    } catch (err) {
      console.error(`OCR failed for invoice ${invoiceId}:`, err)

      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { ocrStatus: 'failed' },
      })

      throw err
    }
  },
  {
    connection: { url: config.redis.url },
    concurrency: 3,
  },
)

ocrWorker.on('failed', (job, err) => {
  console.error(`OCR job ${job?.id} failed:`, err)
})
