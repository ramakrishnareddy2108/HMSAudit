import { api } from '@/lib/api'

// TODO: implement vendor ledger showing invoices, GRNs, payments per vendor per period
// Uses GET /reports/vendor-payments

export default function VendorLedgerPage() {
  // api.get('/reports/vendor-payments', { params: { vendorId, periodMonth, periodYear } })
  void api

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Vendor Ledger</h1>
      <p className="text-muted-foreground">Vendor ledger view — to be implemented.</p>
    </div>
  )
}
