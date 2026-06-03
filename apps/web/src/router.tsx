import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import AppLayout from '@/components/layout/AppLayout'
import RouteErrorPage from '@/components/RouteErrorPage'

import LoginPage from '@/pages/LoginPage'
import InvoiceListPage from '@/pages/InvoiceListPage'
import AddInvoicePage from '@/pages/invoices/AddInvoicePage'
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage'
import EditInvoicePage from '@/pages/invoices/EditInvoicePage'
import ReviewQueuePage from '@/pages/ReviewQueuePage'
import ReviewDetailPage from '@/pages/ReviewDetailPage'
import ReviewHistoryPage from '@/pages/ReviewHistoryPage'
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
import MyDashboardPage from '@/pages/super/MyDashboardPage'
import HospitalsPage from '@/pages/super/HospitalsPage'

type AppRole = 'role_1' | 'role_2' | 'admin'

interface ProtectedRouteProps {
  children: React.ReactNode
  roles?: AppRole[]
  requireHospital?: boolean
  superAdminOnly?: boolean
  redirectTo?: string
}

function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">403 – Forbidden</h1>
      <p className="text-muted-foreground mt-2">You do not have permission to access this page.</p>
    </div>
  )
}

function ProtectedRoute({ children, roles, requireHospital, superAdminOnly, redirectTo }: ProtectedRouteProps) {
  const { user, activeHospitalId } = useAuthStore()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (superAdminOnly && !user.isSuperAdmin) {
    return <Forbidden />
  }

  // Super admin accessing hospital-scoped pages must have a hospital selected
  if (requireHospital && user.isSuperAdmin && !activeHospitalId) {
    return <Navigate to="/super/dashboard" replace />
  }

  // Role check — super admin bypasses role restrictions
  if (roles && !user.isSuperAdmin && !roles.includes(user.role)) {
    return redirectTo ? <Navigate to={redirectTo} replace /> : <Forbidden />
  }

  return <>{children}</>
}

function RootRedirect() {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (user.isSuperAdmin) return <Navigate to="/super/dashboard" replace />
  if (user.role === 'admin') return <Navigate to="/admin/dashboard" replace />
  if (user.role === 'role_2') return <Navigate to="/review" replace />
  return <Navigate to="/invoices" replace />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <RootRedirect /> },

      // ── Super admin routes ───────────────────────────────────────────────
      {
        path: 'super/dashboard',
        element: (
          <ProtectedRoute superAdminOnly>
            <MyDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'super/hospitals',
        element: (
          <ProtectedRoute superAdminOnly>
            <HospitalsPage />
          </ProtectedRoute>
        ),
      },

      // ── Invoice routes (all roles) ───────────────────────────────────────
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
          <ProtectedRoute roles={['role_1', 'admin']} requireHospital redirectTo="/review">
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
          <ProtectedRoute roles={['role_1', 'admin']} requireHospital>
            <EditInvoicePage />
          </ProtectedRoute>
        ),
      },

      // ── Review routes ────────────────────────────────────────────────────
      {
        path: 'review',
        element: (
          <ProtectedRoute roles={['role_2', 'admin']}>
            <ReviewQueuePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review/history',
        element: (
          <ProtectedRoute roles={['role_2', 'admin']}>
            <ReviewHistoryPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'review/:id',
        element: (
          <ProtectedRoute roles={['role_2', 'admin']}>
            <ReviewDetailPage />
          </ProtectedRoute>
        ),
      },

      // ── Admin routes ─────────────────────────────────────────────────────
      {
        path: 'admin/dashboard',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/grn-sync',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <GrnSyncPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reconciliation',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <ReconciliationPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/payments',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <PaymentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/ledger',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <VendorLedgerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/vendors',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <VendorManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/departments',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <DepartmentManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <UserManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute roles={['admin']} requireHospital>
            <ReportsPage />
          </ProtectedRoute>
        ),
      },

      // ── Notifications ────────────────────────────────────────────────────
      {
        path: 'notifications',
        element: (
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
])
