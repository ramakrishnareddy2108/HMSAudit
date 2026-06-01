import * as XLSX from 'xlsx'

export interface GrnRow {
  vendorName: string | null
  invoiceNumber: string | null
  grnNumber: string
  grnAmount: number
  grnDate: string | null
}

const COLUMN_ALIASES: Record<string, keyof GrnRow> = {
  vendor_name: 'vendorName',
  vendor: 'vendorName',
  invoice_number: 'invoiceNumber',
  invoice_no: 'invoiceNumber',
  grn_number: 'grnNumber',
  grn_no: 'grnNumber',
  grn_amount: 'grnAmount',
  amount: 'grnAmount',
  grn_date: 'grnDate',
  date: 'grnDate',
}

const REQUIRED_FIELDS: Array<keyof GrnRow> = ['grnNumber', 'grnAmount']

function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

export class ExcelService {
  parseGrnExcel(buffer: Buffer): GrnRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheetName = workbook.SheetNames[0]

    if (!sheetName) throw new Error('Excel file has no sheets')

    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

    if (rawRows.length === 0) return []

    const colMap = new Map<string, keyof GrnRow>()
    for (const key of Object.keys(rawRows[0])) {
      const normalized = normalizeHeader(key)
      const field = COLUMN_ALIASES[normalized]
      if (field) colMap.set(key, field)
    }

    const presentFields = new Set(colMap.values())
    for (const req of REQUIRED_FIELDS) {
      if (!presentFields.has(req)) {
        const aliases = Object.entries(COLUMN_ALIASES)
          .filter(([, v]) => v === req)
          .map(([k]) => k)
          .join(' / ')
        throw new Error(`Required column missing: expected one of [${aliases}]`)
      }
    }

    const rows: GrnRow[] = []

    for (const raw of rawRows) {
      const mapped: Partial<Record<keyof GrnRow, unknown>> = {}
      for (const [rawKey, field] of colMap.entries()) {
        mapped[field] = raw[rawKey]
      }

      const rawGrnNumber = mapped.grnNumber
      if (!rawGrnNumber || String(rawGrnNumber).trim() === '') continue

      const grnAmount = Number(mapped.grnAmount)
      if (isNaN(grnAmount)) continue

      let grnDate: string | null = null
      const rawDate = mapped.grnDate
      if (rawDate instanceof Date) {
        grnDate = rawDate.toISOString().slice(0, 10)
      } else if (typeof rawDate === 'string' && rawDate.trim()) {
        grnDate = rawDate.trim()
      } else if (typeof rawDate === 'number') {
        const jsDate = new Date(Math.round((rawDate - 25569) * 86400 * 1000))
        grnDate = jsDate.toISOString().slice(0, 10)
      }

      const rawVendorName = mapped.vendorName
      const rawInvoiceNumber = mapped.invoiceNumber

      rows.push({
        grnNumber: String(rawGrnNumber).trim(),
        grnAmount,
        grnDate,
        vendorName:
          rawVendorName && String(rawVendorName).trim() ? String(rawVendorName).trim() : null,
        invoiceNumber:
          rawInvoiceNumber && String(rawInvoiceNumber).trim()
            ? String(rawInvoiceNumber).trim()
            : null,
      })
    }

    return rows
  }

  generateExportBuffer(data: Record<string, unknown>[]): Buffer {
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
}

export const excelService = new ExcelService()
