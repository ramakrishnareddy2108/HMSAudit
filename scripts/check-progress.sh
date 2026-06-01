#!/bin/bash
# Shows which prompts are done based on expected files existing

echo ""
echo "================================================"
echo "  HMS Invoice Tracker — Progress Check"
echo "================================================"
echo ""

check() {
  local label=$1
  local file=$2
  if [ -f "$file" ]; then
    echo "  ✅ $label"
  else
    echo "  ⬜ $label  ← next to run"
  fi
}

echo "COMPLETED (before prompts):"
check "Monorepo scaffold"              "apps/api/src/index.ts"
check "Prisma schema pushed"           "apps/api/prisma/schema.prisma"
check "Auth system"                    "apps/api/src/routes/auth.ts"
check "Vendor management (P01)"        "apps/api/src/routes/vendors.ts"
check "Invoice list page (P02)"        "apps/web/src/pages/InvoiceListPage.tsx"
check "Add Invoice wizard (P03)"       "apps/web/src/pages/invoices/AddInvoicePage.tsx"

echo ""
echo "REMAINING PROMPTS:"
check "P04a — Invoice detail backend"  "apps/api/src/routes/invoices.ts"
check "P04b — Invoice detail frontend" "apps/web/src/pages/invoices/InvoiceDetailPage.tsx"
check "P05a — Edit invoice backend"    "apps/api/src/services/invoiceService.ts"
check "P05b — Edit invoice frontend"   "apps/web/src/pages/invoices/EditInvoicePage.tsx"
check "P06a — Review queue backend"    "apps/api/src/routes/invoices.ts"
check "P06b — Review queue frontend"   "apps/web/src/pages/ReviewQueuePage.tsx"
check "P07  — User + Dept management"  "apps/web/src/pages/admin/UserManagementPage.tsx"
check "P08  — GRN Excel sync"          "apps/api/src/routes/grnSync.ts"
check "P09  — Reconciliation engine"   "apps/api/src/services/reconciliationService.ts"
check "P10  — Payment flow"            "apps/api/src/routes/payments.ts"
check "P11  — Ledger + Dashboard"      "apps/web/src/pages/admin/DashboardPage.tsx"
check "P12  — Notifications + Layout"  "apps/api/src/routes/notifications.ts"
check "P13  — Polish + Deploy"         "apps/api/Dockerfile"

echo ""

# Count completed vs total
TOTAL=13
DONE=0

files=(
  "apps/web/src/pages/invoices/InvoiceDetailPage.tsx"
  "apps/web/src/pages/invoices/EditInvoicePage.tsx"
  "apps/web/src/pages/ReviewQueuePage.tsx"
  "apps/web/src/pages/admin/UserManagementPage.tsx"
  "apps/api/src/routes/grnSync.ts"
  "apps/api/src/services/reconciliationService.ts"
  "apps/api/src/routes/payments.ts"
  "apps/web/src/pages/admin/DashboardPage.tsx"
  "apps/api/src/routes/notifications.ts"
  "apps/api/Dockerfile"
)

for f in "${files[@]}"; do
  [ -f "$f" ] && DONE=$((DONE + 1))
done

echo "  Progress: $DONE / $TOTAL prompts complete"
echo ""

# Suggest next prompt to run
NEXT=""
[ ! -f "apps/web/src/pages/invoices/InvoiceDetailPage.tsx" ] && NEXT="p04a-invoice-detail-backend"
[ -f "apps/web/src/pages/invoices/InvoiceDetailPage.tsx" ] && [ ! -f "apps/web/src/pages/invoices/EditInvoicePage.tsx" ] && NEXT="p05a-edit-invoice-backend"
[ -f "apps/web/src/pages/invoices/EditInvoicePage.tsx" ] && [ ! -f "apps/web/src/pages/ReviewQueuePage.tsx" ] && NEXT="p06a-review-backend"
[ -f "apps/web/src/pages/ReviewQueuePage.tsx" ] && [ ! -f "apps/web/src/pages/admin/UserManagementPage.tsx" ] && NEXT="p07-user-dept-management"
[ -f "apps/web/src/pages/admin/UserManagementPage.tsx" ] && [ ! -f "apps/api/src/routes/grnSync.ts" ] && NEXT="p08-grn-sync"
[ -f "apps/api/src/routes/grnSync.ts" ] && [ ! -f "apps/api/src/services/reconciliationService.ts" ] && NEXT="p09-reconciliation"
[ -f "apps/api/src/services/reconciliationService.ts" ] && [ ! -f "apps/api/src/routes/payments.ts" ] && NEXT="p10-payments"
[ -f "apps/api/src/routes/payments.ts" ] && [ ! -f "apps/web/src/pages/admin/DashboardPage.tsx" ] && NEXT="p11-ledger-dashboard-reports"
[ -f "apps/web/src/pages/admin/DashboardPage.tsx" ] && [ ! -f "apps/api/src/routes/notifications.ts" ] && NEXT="p12-notifications-layout"
[ -f "apps/api/src/routes/notifications.ts" ] && [ ! -f "apps/api/Dockerfile" ] && NEXT="p13-polish-deploy"

if [ -n "$NEXT" ]; then
  echo "  ▶️  Run next: bash scripts/run-prompt.sh $NEXT"
  echo ""
fi
