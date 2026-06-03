import { AsyncLocalStorage } from 'async_hooks'

export const tenantStorage = new AsyncLocalStorage<string | null>()

export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Vendor',
  'Invoice',
  'GrnEntry',
  'GrnMaster',
  'GrnSyncRun',
  'GrnConflict',
  'ReconciliationRun',
  'ReconResult',
  'Payment',
  'Department',
  'AuditLog',
  'Notification',
])
