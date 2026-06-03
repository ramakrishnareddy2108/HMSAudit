import vision from '@google-cloud/vision'
import OpenAI from 'openai'
import { config } from '../config'

const visionClient = new vision.ImageAnnotatorClient({
  apiKey: config.google.visionApiKey,
})

interface OcrConfidence {
  vendorName: number
  invoiceNumber: number
  invoiceDate: number
  invoiceAmount: number
}

interface OcrExtractedData {
  vendorName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  currency: string | null
  confidence: OcrConfidence
}

export interface OcrResult extends OcrExtractedData {
  rawText: string
  modelUsed: string
  failed: boolean
}

const EXTRACTION_SYSTEM_PROMPT = `You are an invoice data extraction specialist
for an Indian hospital procurement system.

Given raw OCR text from a vendor invoice image, extract the fields below and
return ONLY a valid JSON object. No prose, no explanation, no markdown fences.

Required JSON structure:
{
  "vendorName": string or null,
  "invoiceNumber": string or null,
  "invoiceDate": string in YYYY-MM-DD format or null,
  "invoiceAmount": number with no currency symbols or commas or null,
  "currency": "INR" or other currency code or null,
  "confidence": {
    "vendorName": number between 0.0 and 1.0,
    "invoiceNumber": number between 0.0 and 1.0,
    "invoiceDate": number between 0.0 and 1.0,
    "invoiceAmount": number between 0.0 and 1.0
  }
}

Rules:
- Dates MUST be in YYYY-MM-DD format. Convert DD/MM/YYYY or MM/DD/YYYY if needed.
- Amounts MUST be plain numbers. Strip Rs., INR, commas, spaces.
- Set confidence below 0.7 if a field is ambiguous or partially visible.
- Return null for any field you cannot determine with reasonable confidence.
- Never guess. Accuracy is more important than completeness.
- Indian invoices often show amounts in words — prefer the numeric figure.`

export class OcrService {
  private openai: OpenAI

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    })
  }

  async extractFromUrl(fileUrl: string, invoiceNumber = 'unknown'): Promise<OcrResult> {
    let rawText = ''
    try {
      console.log(`[OCR] Vision API called — invoice: ${invoiceNumber}`)
      rawText = await this.callGoogleVision(fileUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[OCR] Failed — ${msg}, invoice created without OCR data`)
      return this.emptyResult('', true)
    }
    try {
      const extracted = await this.callOpenAIExtraction(rawText)
      return { ...extracted, rawText, modelUsed: config.openai.ocrModel, failed: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[OCR] Failed — ${msg}, invoice created without OCR data`)
      return this.emptyResult(rawText, false)
    }
  }

  private emptyResult(rawText = '', failed = false): OcrResult {
    return {
      vendorName: null,
      invoiceNumber: null,
      invoiceDate: null,
      invoiceAmount: null,
      currency: null,
      confidence: { vendorName: 0, invoiceNumber: 0, invoiceDate: 0, invoiceAmount: 0 },
      rawText,
      modelUsed: config.openai.ocrModel,
      failed,
    }
  }

  private async callGoogleVision(imageUrl: string): Promise<string> {
    const [result] = await visionClient.documentTextDetection({
      image: { source: { imageUri: imageUrl } },
    })
    const text = result.fullTextAnnotation?.text
    if (!text) {
      throw new Error('Google Vision returned no text — image may be unreadable')
    }
    return text
  }

  private async callOpenAIExtraction(rawText: string): Promise<OcrExtractedData> {
    const completion = await this.openai.chat.completions.create({
      model: config.openai.ocrModel,
      max_tokens: 500,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: EXTRACTION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `Extract invoice data from this OCR text:\n\n${rawText}`,
        },
      ],
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('OpenAI returned empty response')
    }

    const parsed = JSON.parse(content) as OcrExtractedData

    return {
      vendorName: parsed.vendorName ?? null,
      invoiceNumber: parsed.invoiceNumber ?? null,
      invoiceDate: parsed.invoiceDate ?? null,
      invoiceAmount: typeof parsed.invoiceAmount === 'number' ? parsed.invoiceAmount : null,
      currency: parsed.currency ?? 'INR',
      confidence: {
        vendorName: parsed.confidence?.vendorName ?? 0,
        invoiceNumber: parsed.confidence?.invoiceNumber ?? 0,
        invoiceDate: parsed.confidence?.invoiceDate ?? 0,
        invoiceAmount: parsed.confidence?.invoiceAmount ?? 0,
      },
    }
  }
}

export const ocrService = new OcrService()
