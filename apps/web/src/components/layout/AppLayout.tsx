import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  FileText,
  ClipboardCheck,
  UploadCloud,
  GitMerge,
  CreditCard,
  BookOpen,
  Store,
  Users,
  BarChart2,
  LayoutDashboard,
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  roles?: Array<'role_1' | 'role_2' | 'admin'>
}

const navItems: NavItem[] = [
  { label: 'Invoices', href: '/invoices', icon: <FileText size={18} /> },
  { label: 'Review Queue', href: '/review', icon: <ClipboardCheck size={18} />, roles: ['role_2', 'admin'] },
  { label: 'Dashboard', href: '/admin/dashboard', icon: <LayoutDashboard size={18} />, roles: ['admin'] },
  { label: 'GRN Sync', href: '/admin/grn-sync', icon: <UploadCloud size={18} />, roles: ['admin'] },
  { label: 'Reconciliation', href: '/admin/reconciliation', icon: <GitMerge size={18} />, roles: ['admin'] },
  { label: 'Payments', href: '/admin/payments', icon: <CreditCard size={18} />, roles: ['admin'] },
  { label: 'Vendor Ledger', href: '/admin/ledger', icon: <BookOpen size={18} />, roles: ['admin'] },
  { label: 'Vendors', href: '/admin/vendors', icon: <Store size={18} />, roles: ['admin'] },
  { label: 'Users', href: '/admin/users', icon: <Users size={18} />, roles: ['admin'] },
  { label: 'Reports', href: '/admin/reports', icon: <BarChart2 size={18} />, roles: ['admin'] },
]

export default function AppLayout() {
  const { user, clearAuth, isRole2, isAdmin } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const visibleNav = navItems.filter((item) => {
    if (!item.roles) return true
    if (isAdmin()) return true
    if (isRole2() && item.roles.includes('role_2')) return true
    if (user?.role === 'role_1' && item.roles.includes('role_1')) return true
    return false
  })

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-card border-r transition-transform duration-200 lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center px-4 border-b font-semibold text-sm tracking-tight">
          Hospital Invoice Tracker
        </div>
        <nav className="flex-1 overflow-y-auto py-4 space-y-0.5 px-2">
          {visibleNav.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 items-center justify-between border-b px-4 bg-card">
          <button
            className="lg:hidden p-1 rounded-md hover:bg-accent"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="flex items-center gap-3 ml-auto">
            {/* Notification bell */}
            <button className="relative p-1.5 rounded-md hover:bg-accent">
              <Bell size={18} />
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive" />
            </button>

            {/* User avatar + dropdown */}
            <div className="relative">
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent text-sm"
                onClick={() => setProfileOpen((v) => !v)}
              >
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium uppercase">
                  {user?.name?.charAt(0) ?? 'U'}
                </div>
                <span className="hidden sm:block">{user?.name}</span>
                <ChevronDown size={14} />
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-popover shadow-md z-50">
                  <div className="px-3 py-2 text-xs text-muted-foreground border-b">{user?.email}</div>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                    onClick={handleLogout}
                  >
                    <LogOut size={14} />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Close sidebar button on mobile when open */}
      {sidebarOpen && (
        <button
          className="fixed top-3 left-56 z-40 p-1 rounded-md bg-card border lg:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
