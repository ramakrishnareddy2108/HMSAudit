export interface Vendor {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  gstNumber: string | null
  bankDetails: unknown | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}
