import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuthStore, type AuthUser } from '@/stores/authStore'
import AppLayout from '@/components/layout/AppLayout'

import LoginPage from '@/pages/LoginPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import InvoiceListPage from '@/pages/InvoiceListPage'
import AddInvoicePage from '@/pages/invoices/AddInvoicePage'
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage'
import EditInvoicePage from '@/pages/invoices/EditInvoicePage'
import ReviewQueuePage from '@/pages/ReviewQueuePage'
import ReviewDetailPage from '@/pages/ReviewDetailPage'
import GrnSyncPage from '@/pages/admin/GrnSyncPage'
import ReconciliationPage from '@/pages/admin/ReconciliationPage'
import PaymentsPage from '@/pages/admin/PaymentsPage'
import VendorLedgerPage from '@/pages/admin/VendorLedgerPage'
import VendorManagementPage from '@/pages/admin/VendorManagementPage'
import DepartmentManagementPage from '@/pages/admin/DepartmentManagementPage'
import UserManagementPage from '@/pages/admin/UserManagementPage'
import NotificationsPage from '@/pages/NotificationsPage'
import ReportsPage from '@/pages/admin/ReportsPage'
import DashboardPage from '@/pages/admin/DashboardPage'

type AppRole = AuthUser['role']

interface ProtectedRouteProps {
  children: React.ReactNode
  roles?: AppRole[]
}

function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (roles && !roles.includes(user.role)) {
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
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
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
          <ProtectedRoute roles={["role_1", "admin"]}>
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
          <ProtectedRoute roles={["role_1", "admin"]}>
            <EditInvoicePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review',
        element: (
          <ProtectedRoute roles={["role_2", "admin"]}>
            <ReviewQueuePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review/:id',
        element: (
          <ProtectedRoute roles={["role_2", "admin"]}>
            <ReviewDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/grn-sync',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <GrnSyncPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reconciliation',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <ReconciliationPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/payments',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <PaymentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/ledger',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <VendorLedgerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/vendors',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <VendorManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/departments',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <DepartmentManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'notifications',
        element: (
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <UserManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <ReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/dashboard',
        element: (
          <ProtectedRoute roles={["admin"]}>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
])
