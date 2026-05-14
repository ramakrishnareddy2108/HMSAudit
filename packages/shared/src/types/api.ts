export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  error: string
  details?: Array<{
    field: string
    message: string
  }>
}

export interface ApiSuccess<T = void> {
  data: T
  message?: string
}
