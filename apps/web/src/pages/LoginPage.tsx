import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'

// TODO: implement login form with react-hook-form + zod

export default function LoginPage() {
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  // api.post('/auth/login', { email, password })
  void api
  void setAuth
  void navigate

  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">Login</h1>
    </div>
  )
}
