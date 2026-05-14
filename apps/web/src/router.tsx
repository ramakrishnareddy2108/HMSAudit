import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Role } from '@shared/types/user'
import type { User } from '@shared/types/user'
import AppLayout from '@/components/layout/AppLayout'

import LoginPage from '@/pages/LoginPage'
import InvoiceListPage from '@/pages/InvoiceListPage'
import AddInvoicePage from '@/pages/AddInvoicePage'
import InvoiceDetailPage from '@/pages/InvoiceDetailPage'
import EditInvoicePage from '@/pages/EditInvoicePage'
import ReviewQueuePage from '@/pages/ReviewQueuePage'
import ReviewDetailPage from '@/pages/ReviewDetailPage'
import GrnSyncPage from '@/pages/admin/GrnSyncPage'
import ReconciliationPage from '@/pages/admin/ReconciliationPage'
import PaymentsPage from '@/pages/admin/PaymentsPage'
import VendorLedgerPage from '@/pages/admin/VendorLedgerPage'
import VendorManagementPage from '@/pages/admin/VendorManagementPage'
import UserManagementPage from '@/pages/admin/UserManagementPage'
import ReportsPage from '@/pages/admin/ReportsPage'
import DashboardPage from '@/pages/admin/DashboardPage'

interface ProtectedRouteProps {
  children: React.ReactNode
  roles?: Role[]
}

function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (roles && !roles.includes((user as User).role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold">403 – Forbidden</h1>
        <p className="text-muted-foreground mt-2">You do not have permission to access this page.</p>
      </div>
    )
  }

  return <>{children}</>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/invoices" replace /> },
      {
        path: 'invoices',
        element: (
          <ProtectedRoute>
            <InvoiceListPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'invoices/new',
        element: (
          <ProtectedRoute roles={[Role.role_1, Role.admin]}>
            <AddInvoicePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'invoices/:id',
        element: (
          <ProtectedRoute>
            <InvoiceDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'invoices/:id/edit',
        element: (
          <ProtectedRoute roles={[Role.role_1, Role.admin]}>
            <EditInvoicePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review',
        element: (
          <ProtectedRoute roles={[Role.role_2, Role.admin]}>
            <ReviewQueuePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review/:id',
        element: (
          <ProtectedRoute roles={[Role.role_2, Role.admin]}>
            <ReviewDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/grn-sync',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <GrnSyncPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reconciliation',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <ReconciliationPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/payments',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <PaymentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/ledger',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <VendorLedgerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/vendors',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <VendorManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <UserManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <ReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/dashboard',
        element: (
          <ProtectedRoute roles={[Role.admin]}>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
])
