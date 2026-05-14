export enum BillType {
  grn_bill = 'grn_bill',
  miscellaneous = 'miscellaneous',
}

export enum InvoiceStatus {
  draft = 'draft',
  pending_review = 'pending_review',
  sent_back = 'sent_back',
  re_submitted = 're_submitted',
  approved = 'approved',
  reconciled = 'reconciled',
  paid = 'paid',
}

export enum OcrStatus {
  pending = 'pending',
  processing = 'processing',
  done = 'done',
  failed = 'failed',
}

export interface InvoiceListItem {
  id: string
  vendorId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string | null
  invoiceAmount: number
  departmentId: string | null
  departmentName: string | null
  billType: BillType
  status: InvoiceStatus
  ocrStatus: OcrStatus
  uploadedBy: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceDetail extends InvoiceListItem {
  miscCategory: string | null
  miscDescription: string | null
  fileUrl: string | null
  ocrExtractedJson: unknown
  currentVersionNo: number
  submittedAt: string | null
  reviewedBy: string | null
  reviewerNote: string | null
  isPriceRevised: boolean
}

export interface InvoiceVersion {
  id: string
  invoiceId: string
  versionNo: number
  fileUrl: string | null
  invoiceAmount: number
  statusAtChange: InvoiceStatus
  changedBy: string
  changeReason: string | null
  createdAt: string
}
