import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config'

interface OcrConfidence {
  vendorName: number
  invoiceNumber: number
  invoiceDate: number
  invoiceAmount: number
}

interface OcrResult {
  vendorName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  currency: string | null
  confidence: OcrConfidence
  rawText: string
  modelUsed: string
}

interface VisionResponse {
  responses: Array<{
    fullTextAnnotation?: {
      text: string
    }
    error?: {
      message: string
    }
  }>
}

interface ExtractionResult {
  vendorName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  currency: string | null
  confidence: OcrConfidence
}

export class OcrService {
  private anthropic: Anthropic

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey })
  }

  async extractFromUrl(fileUrl: string): Promise<OcrResult> {
    const rawText = await this.callGoogleVision(fileUrl)
    const extracted = await this.callAnthropicExtraction(rawText)

    return {
      ...extracted,
      rawText,
      modelUsed: 'claude-sonnet-4-20250514',
    }
  }

  private async callGoogleVision(imageUrl: string): Promise<string> {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${config.google.visionApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { source: { imageUri: imageUrl } },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
          ],
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Google Vision API error: ${response.statusText}`)
    }

    const data = (await response.json()) as VisionResponse
    const result = data.responses[0]

    if (result.error) {
      throw new Error(`Google Vision error: ${result.error.message}`)
    }

    return result.fullTextAnnotation?.text ?? ''
  }

  private async callAnthropicExtraction(rawText: string): Promise<ExtractionResult> {
    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are an invoice data extraction assistant. Extract structured data from invoice text.
Return ONLY valid JSON with no prose or markdown fences. The JSON must have these fields:
- vendorName: string or null
- invoiceNumber: string or null
- invoiceDate: string in YYYY-MM-DD format or null
- invoiceAmount: number or null
- currency: string (e.g. "INR", "USD") or null
- confidence: object with keys vendorName, invoiceNumber, invoiceDate, invoiceAmount, each a float 0.0-1.0`,
      messages: [{ role: 'user', content: rawText }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic')
    }

    const parsed = JSON.parse(content.text) as ExtractionResult
    return parsed
  }
}

export const ocrService = new OcrService()
