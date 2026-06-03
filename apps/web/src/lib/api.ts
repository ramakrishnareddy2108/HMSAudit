import axios from 'axios'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  const { activeHospitalId } = useAuthStore.getState()
  if (activeHospitalId) {
    config.headers['X-Hospital-Id'] = activeHospitalId
  }

  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      toast.error('Cannot connect to server. Check your connection.')
      return Promise.reject(error)
    }

    const { status, data } = error.response as { status: number; data: Record<string, string> }

    if (status === 401) {
      useAuthStore.getState().clearAuth()
      if (window.location.pathname !== '/login') {
        toast.error('Session expired. Please login again.')
        window.location.href = '/login'
      }
    } else if (status === 403) {
      toast.error("You don't have permission to do this")
    } else if (status === 404) {
      toast.error('Record not found')
    } else if (status === 409) {
      toast.error(data?.message ?? data?.error ?? 'Record already exists')
    } else if (status >= 500) {
      toast.error('Something went wrong. Please try again.')
    }

    ;(error as { _toasted?: boolean })._toasted = true
    return Promise.reject(error)
  },
)
