import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  FileText,
  ClipboardCheck,
  History,
  UploadCloud,
  GitMerge,
  CreditCard,
  BookOpen,
  Store,
  Users,
  BarChart2,
  LayoutDashboard,
  Bell,
  Building2,
  ChevronDown,
  LogOut,
  Menu,
  X,
  Hospital,
  Globe,
} from 'lucide-react'

interface HospitalSummary {
  id: string
  name: string
  isActive: boolean
}

function HospitalSwitcher() {
  const { activeHospitalId, activeHospitalName, setActiveHospital } = useAuthStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const { data: hospitals = [] } = useQuery<HospitalSummary[]>({
    queryKey: ['super-hospitals-switcher'],
    queryFn: () => api.get('/super/hospitals').then((r) => r.data),
    staleTime: 60_000,
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent',
          activeHospitalId ? 'text-foreground' : 'text-amber-600',
        )}
      >
        <Hospital size={15} />
        <span className="max-w-[180px] truncate">
          {activeHospitalName ?? 'Select a Hospital'}
        </span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 rounded-md border bg-popover shadow-lg z-50">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b">
            Switch Hospital
          </div>
          <div className="py-1 max-h-60 overflow-y-auto">
            {hospitals
              .filter((h) => h.isActive)
              .map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setActiveHospital(h.id, h.name)
                    queryClient.removeQueries()
                    navigate(location.pathname, { replace: true, state: { hospitalChanged: true } })
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left',
                    activeHospitalId === h.id && 'bg-accent font-medium',
                  )}
                >
                  <Hospital size={13} className="shrink-0 text-muted-foreground" />
                  {h.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AppLayout() {
  const { user, clearAuth, isSuperAdminUser, activeHospitalId } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const isSuper = isSuperAdminUser()
  const hasHospital = Boolean(activeHospitalId)

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  type NavItem = { label: string; href: string; icon: React.ReactNode }

  function buildNavItems(): NavItem[] {
    if (isSuper) {
      const superItems: NavItem[] = [
        { label: 'My Dashboard', href: '/super/dashboard', icon: <Globe size={18} /> },
        { label: 'Hospitals', href: '/super/hospitals', icon: <Hospital size={18} /> },
      ]
      if (!hasHospital) return superItems

      return [
        ...superItems,
        { label: 'All Invoices', href: '/invoices', icon: <FileText size={18} /> },
        { label: 'Review Queue', href: '/review', icon: <ClipboardCheck size={18} /> },
        { label: 'GRN Sync', href: '/admin/grn-sync', icon: <UploadCloud size={18} /> },
        { label: 'Reconciliation', href: '/admin/reconciliation', icon: <GitMerge size={18} /> },
        { label: 'Payments', href: '/admin/payments', icon: <CreditCard size={18} /> },
        { label: 'Vendor Ledger', href: '/admin/ledger', icon: <BookOpen size={18} /> },
        { label: 'Vendors', href: '/admin/vendors', icon: <Store size={18} /> },
        { label: 'Users', href: '/admin/users', icon: <Users size={18} /> },
        { label: 'Departments', href: '/admin/departments', icon: <Building2 size={18} /> },
        { label: 'Reports', href: '/admin/reports', icon: <BarChart2 size={18} /> },
      ]
    }

    if (user?.role === 'admin') {
      return [
        { label: 'Dashboard', href: '/admin/dashboard', icon: <LayoutDashboard size={18} /> },
        { label: 'All Invoices', href: '/invoices', icon: <FileText size={18} /> },
        { label: 'Review Queue', href: '/review', icon: <ClipboardCheck size={18} /> },
        { label: 'GRN Sync', href: '/admin/grn-sync', icon: <UploadCloud size={18} /> },
        { label: 'Reconciliation', href: '/admin/reconciliation', icon: <GitMerge size={18} /> },
        { label: 'Payments', href: '/admin/payments', icon: <CreditCard size={18} /> },
        { label: 'Vendor Ledger', href: '/admin/ledger', icon: <BookOpen size={18} /> },
        { label: 'Vendors', href: '/admin/vendors', icon: <Store size={18} /> },
        { label: 'Users', href: '/admin/users', icon: <Users size={18} /> },
        { label: 'Departments', href: '/admin/departments', icon: <Building2 size={18} /> },
        { label: 'Reports', href: '/admin/reports', icon: <BarChart2 size={18} /> },
      ]
    }

    if (user?.role === 'role_2') {
      return [
        { label: 'Review Queue', href: '/review', icon: <ClipboardCheck size={18} /> },
        { label: 'All Invoices', href: '/invoices', icon: <FileText size={18} /> },
        { label: 'Reviewed History', href: '/review/history', icon: <History size={18} /> },
      ]
    }

    return [
      { label: 'My Invoices', href: '/invoices', icon: <FileText size={18} /> },
      { label: 'New Invoice', href: '/invoices/new', icon: <FileText size={18} /> },
    ]
  }

  const navItems = buildNavItems()

  const superSection = isSuper && hasHospital
  const hospitalSectionLabel = isSuper
    ? (activeHospitalId ? useAuthStore.getState().activeHospitalName : null)
    : null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
          HMS Invoice Tracker
        </div>

        <nav className="flex-1 overflow-y-auto py-4 space-y-0.5 px-2">
          {superSection ? (
            <>
              {/* Super admin section */}
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Super Admin
              </p>
              {navItems.slice(0, 2).map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end
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

              {/* Hospital section */}
              <p className="mt-3 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
                {hospitalSectionLabel}
              </p>
              {navItems.slice(2).map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end
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
            </>
          ) : (
            navItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end
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
            ))
          )}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 items-center justify-between border-b px-4 bg-card gap-3">
          <button
            className="lg:hidden p-1 rounded-md hover:bg-accent"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          {/* Hospital switcher — super admin only */}
          {isSuper && <HospitalSwitcher />}

          <div className="flex items-center gap-3 ml-auto">
            <button
              className="relative p-1.5 rounded-md hover:bg-accent"
              onClick={() => navigate('/notifications')}
            >
              <Bell size={18} />
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive" />
            </button>

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
                  <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                    {user?.email}
                  </div>
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

        <main key={activeHospitalId || 'no-hospital'} className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

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
