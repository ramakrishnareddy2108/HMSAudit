export enum Role {
  role_1 = 'role_1',
  role_2 = 'role_2',
  admin = 'admin',
}

export interface User {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  createdAt: string
}

export interface UserDepartment {
  id: string
  userId: string
  departmentId: string
}

export interface Department {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}
