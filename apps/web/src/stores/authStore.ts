import { create } from 'zustand'
import { Role } from '@shared/types/user'
import type { User } from '@shared/types/user'

interface AuthStore {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  clearAuth: () => void
  isRole1: () => boolean
  isRole2: () => boolean
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: localStorage.getItem('auth_token'),

  setAuth: (user, token) => {
    localStorage.setItem('auth_token', token)
    set({ user, token })
  },

  clearAuth: () => {
    localStorage.removeItem('auth_token')
    set({ user: null, token: null })
  },

  isRole1: () => get().user?.role === Role.role_1,
  isRole2: () => get().user?.role === Role.role_2,
  isAdmin: () => get().user?.role === Role.admin,
}))
