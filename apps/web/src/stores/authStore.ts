import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'role_1' | 'role_2' | 'admin'
  hospitalId: string | null
  isSuperAdmin: boolean
  departments: { id: string; name: string }[]
}

interface AuthStore {
  user: AuthUser | null
  token: string | null
  activeHospitalId: string | null
  activeHospitalName: string | null
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
  setActiveHospital: (id: string, name: string) => void
  clearActiveHospital: () => void
  isRole1: () => boolean
  isRole2: () => boolean
  isAdmin: () => boolean
  isSuperAdminUser: () => boolean
  canReview: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      activeHospitalId: null,
      activeHospitalName: null,

      setAuth: (user, token) => {
        localStorage.setItem('auth_token', token)
        set({ user, token })
      },

      clearAuth: () => {
        localStorage.removeItem('auth_token')
        set({ user: null, token: null, activeHospitalId: null, activeHospitalName: null })
      },

      setActiveHospital: (id, name) => {
        set({ activeHospitalId: id, activeHospitalName: name })
      },

      clearActiveHospital: () => {
        set({ activeHospitalId: null, activeHospitalName: null })
      },

      isRole1: () => get().user?.role === 'role_1',
      isRole2: () => get().user?.role === 'role_2',
      isAdmin: () => get().user?.role === 'admin',
      isSuperAdminUser: () => get().user?.isSuperAdmin === true,
      canReview: () => {
        const u = get().user
        if (!u) return false
        return u.role === 'role_2' || u.role === 'admin'
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        activeHospitalId: state.activeHospitalId,
        activeHospitalName: state.activeHospitalName,
      }),
    },
  ),
)
