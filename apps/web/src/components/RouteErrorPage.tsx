import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()

  let title = 'Something went wrong'
  let message = 'An unexpected error occurred. Please try again.'

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Page not found'
      message = "The page you're looking for doesn't exist."
    } else if (error.status === 403) {
      title = 'Access denied'
      message = "You don't have permission to access this page."
    } else {
      message = error.data?.message ?? error.statusText ?? message
    }
  } else if (error instanceof Error) {
    message = error.message
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertTriangle size={36} className="text-destructive" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm max-w-sm">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => navigate(-1)} variant="outline">
          Go back
        </Button>
        <Button onClick={() => navigate('/')}>Go home</Button>
      </div>
    </div>
  )
}
