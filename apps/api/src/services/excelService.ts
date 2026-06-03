import * as XLSX from 'xlsx'

export interface GrnRow {
  vendorName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  grnNumber: string
  grnAmount: number
  grnDate: string | null
}

export interface ParsedGrnRow {
  mapped: GrnRow
  raw: Record<string, unknown>
}

const COLUMN_ALIASES: Record<string, keyof GrnRow> = {
  // Vendor
  supplier_name: 'vendorName',
  vendor_name: 'vendorName',
  vendor: 'vendorName',
  // GRN Number
  grn_no: 'grnNumber',
  grn_number: 'grnNumber',
  // GRN Date
  grn_date: 'grnDate',
  date: 'grnDate',
  // Invoice Number
  invoice_no: 'invoiceNumber',
  invoice_number: 'invoiceNumber',
  // Invoice Date
  invoice_date: 'invoiceDate',
  // Invoice Amount — NOT "total_invoice_amount" (includes TCS charges)
  invoice_amount: 'grnAmount',
  grn_amount: 'grnAmount',
  amount: 'grnAmount',
}

const REQUIRED_FIELDS: Array<keyof GrnRow> = ['grnNumber', 'grnAmount']

function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

function serializeRawValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return value
  return String(value)
}

export class ExcelService {
  parseGrnExcel(buffer: Buffer): ParsedGrnRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheetName = workbook.SheetNames[0]

    if (!sheetName) throw new Error('Excel file has no sheets')

    const sheet = workbook.Sheets[sheetName]
    // range: 1 skips row 1 (report metadata header) and uses row 2 as column headers
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      range: 1,
    })

    if (rawRows.length === 0) return []

    const colMap = new Map<string, keyof GrnRow>()
    for (const key of Object.keys(rawRows[0])) {
      const normalized = normalizeHeader(key)
      const field = COLUMN_ALIASES[normalized]
      if (field) colMap.set(key, field)
    }

    const presentFields = new Set(colMap.values())
    const missingFields: string[] = []
    for (const req of REQUIRED_FIELDS) {
      if (!presentFields.has(req)) missingFields.push(req)
    }
    if (missingFields.length > 0) {
      const foundCols = Object.keys(rawRows[0]).join(', ')
      throw new Error(
        `Required columns missing: ${missingFields.join(', ')}. Found columns: ${foundCols}`,
      )
    }

    const result: ParsedGrnRow[] = []

    for (const rawRow of rawRows) {
      const mapped: Partial<Record<keyof GrnRow, unknown>> = {}
      for (const [rawKey, field] of colMap.entries()) {
        mapped[field] = rawRow[rawKey]
      }

      const rawGrnNumber = mapped.grnNumber
      if (!rawGrnNumber || String(rawGrnNumber).trim() === '') continue

      const grnAmount = Number(mapped.grnAmount)
      if (isNaN(grnAmount)) continue

      const parseDate = (val: unknown): string | null => {
        if (val instanceof Date) return val.toISOString().slice(0, 10)
        if (typeof val === 'string' && val.trim()) return val.trim()
        if (typeof val === 'number') {
          const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000))
          return jsDate.toISOString().slice(0, 10)
        }
        return null
      }

      const rawVendorName = mapped.vendorName
      const rawInvoiceNumber = mapped.invoiceNumber

      const raw: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rawRow)) {
        raw[key] = serializeRawValue(value)
      }

      result.push({
        mapped: {
          grnNumber: String(rawGrnNumber).trim(),
          grnAmount,
          grnDate: parseDate(mapped.grnDate),
          invoiceDate: parseDate(mapped.invoiceDate),
          vendorName:
            rawVendorName && String(rawVendorName).trim() ? String(rawVendorName).trim() : null,
          invoiceNumber:
            rawInvoiceNumber && String(rawInvoiceNumber).trim()
              ? String(rawInvoiceNumber).trim()
              : null,
        },
        raw,
      })
    }

    return result
  }

  generateExportBuffer(data: Record<string, unknown>[]): Buffer {
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
}

export const excelService = new ExcelService()
