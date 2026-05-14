export enum GrnEntryStatus {
  pending = 'pending',
  reconciled = 'reconciled',
  disputed = 'disputed',
  paid = 'paid',
}

export enum SyncRunStatus {
  processing = 'processing',
  completed = 'completed',
  has_conflicts = 'has_conflicts',
}

export enum ReconciliationStatus {
  running = 'running',
  completed = 'completed',
}

export enum MatchStatus {
  matched = 'matched',
  amount_diff = 'amount_diff',
  app_only = 'app_only',
  excel_only = 'excel_only',
}

export enum Resolution {
  accepted_app = 'accepted_app',
  accepted_excel = 'accepted_excel',
  disputed = 'disputed',
}

export enum ConflictResolution {
  keep_system = 'keep_system',
  use_excel = 'use_excel',
}

export enum PaymentMode {
  neft = 'neft',
  rtgs = 'rtgs',
  cheque = 'cheque',
  cash = 'cash',
}

export interface GrnEntry {
  id: string
  invoiceId: string
  grnNumber: string
  grnAmount: number
  grnDate: string | null
  status: GrnEntryStatus
  createdAt: string
  updatedAt: string
}

export interface GrnMaster {
  id: string
  vendorId: string | null
  invoiceNumber: string | null
  grnNumber: string
  grnAmount: number
  grnDate: string | null
  syncRunId: string | null
  createdAt: string
  updatedAt: string
}

export interface GrnSyncRun {
  id: string
  fileUrl: string | null
  runBy: string
  totalRows: number
  inserted: number
  skipped: number
  conflicts: number
  status: SyncRunStatus
  createdAt: string
}

export interface GrnConflict {
  id: string
  syncRunId: string
  grnNumber: string
  systemAmount: number
  excelAmount: number
  resolvedBy: string | null
  resolution: ConflictResolution | null
  adminNote: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface ReconciliationRun {
  id: string
  periodMonth: number
  periodYear: number
  runBy: string
  status: ReconciliationStatus
  totalMatched: number
  totalAmountDiff: number
  totalAppOnly: number
  totalExcelOnly: number
  completedAt: string | null
  completedBy: string | null
  createdAt: string
}

export interface ReconResult {
  id: string
  reconRunId: string
  grnEntryId: string | null
  grnMasterId: string | null
  matchStatus: MatchStatus
  appAmount: number | null
  excelAmount: number | null
  resolution: Resolution | null
  resolvedBy: string | null
  adminNote: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface Payment {
  id: string
  vendorId: string
  periodMonth: number
  periodYear: number
  totalAmount: number
  paymentDate: string
  paymentMode: PaymentMode
  transactionRef: string | null
  remarks: string | null
  emailSent: boolean
  emailSentAt: string | null
  createdBy: string
  createdAt: string
}
