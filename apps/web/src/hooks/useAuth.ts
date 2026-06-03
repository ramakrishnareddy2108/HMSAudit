import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore, type AuthUser } from '../stores/authStore'

interface LoginPayload {
  email: string
  password: string
}

interface LoginResponse {
  token: string
  user: AuthUser
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation<LoginResponse, Error, LoginPayload>({
    mutationFn: async (data) => {
      const res = await api.post<LoginResponse>('/auth/login', data)
      return res.data
    },
    onSuccess: (data) => {
      setAuth(data.user, data.token)
      if (data.user.isSuperAdmin) {
        navigate('/super/dashboard')
      } else if (data.user.role === 'admin') {
        navigate('/admin/dashboard')
      } else if (data.user.role === 'role_2') {
        navigate('/review')
      } else {
        navigate('/invoices')
      }
    },
    onError: (error) => {
      console.error('Login failed:', error)
    },
  })
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout')
    },
    onSuccess: () => {
      clearAuth()
      navigate('/login')
    },
    onError: () => {
      clearAuth()
      navigate('/login')
    },
  })
}
