import * as XLSX from 'xlsx'

interface GrnExcelRow {
  grnNumber: string
  invoiceNumber: string | null
  vendorName: string | null
  grnAmount: number
  grnDate: string | null
}

interface ParseResult {
  rows: GrnExcelRow[]
  errors: string[]
}

export class ExcelService {
  parseGrnUpload(buffer: Buffer): ParseResult {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]

    if (!sheetName) {
      return { rows: [], errors: ['Excel file has no sheets'] }
    }

    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)

    const rows: GrnExcelRow[] = []
    const errors: string[] = []

    rawRows.forEach((raw, idx) => {
      const grnNumber = raw['GRN Number'] ?? raw['grn_number'] ?? raw['GRNNumber']
      if (!grnNumber || typeof grnNumber !== 'string') {
        errors.push(`Row ${idx + 2}: missing or invalid GRN Number`)
        return
      }

      const grnAmount = Number(raw['GRN Amount'] ?? raw['grn_amount'] ?? raw['Amount'])
      if (isNaN(grnAmount) || grnAmount <= 0) {
        errors.push(`Row ${idx + 2}: missing or invalid GRN Amount`)
        return
      }

      rows.push({
        grnNumber: grnNumber.trim(),
        invoiceNumber: typeof raw['Invoice Number'] === 'string' ? raw['Invoice Number'].trim() : null,
        vendorName: typeof raw['Vendor Name'] === 'string' ? raw['Vendor Name'].trim() : null,
        grnAmount,
        grnDate: typeof raw['GRN Date'] === 'string' ? raw['GRN Date'] : null,
      })
    })

    return { rows, errors }
  }

  generateExportBuffer(data: Record<string, unknown>[]): Buffer {
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
}

export const excelService = new ExcelService()
