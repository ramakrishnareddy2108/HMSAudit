import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'role_1' | 'role_2' | 'admin'
  departments: { id: string; name: string }[]
}

interface AuthStore {
  user: AuthUser | null
  token: string | null
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
  isRole1: () => boolean
  isRole2: () => boolean
  isAdmin: () => boolean
  canReview: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      setAuth: (user, token) => {
        localStorage.setItem('auth_token', token)
        set({ user, token })
      },

      clearAuth: () => {
        localStorage.removeItem('auth_token')
        set({ user: null, token: null })
      },

      isRole1: () => get().user?.role === 'role_1',
      isRole2: () => get().user?.role === 'role_2',
      isAdmin: () => get().user?.role === 'admin',
      canReview: () => {
        const role = get().user?.role
        return role === 'role_2' || role === 'admin'
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    },
  ),
)
