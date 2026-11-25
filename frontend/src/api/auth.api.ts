import { api } from '@/lib/api-client';
import type { AuthResponse, User } from '@/types/auth';

export const authApi = {
  login: (body: { email: string; password: string }) =>
    api<AuthResponse>('/auth/login', { method: 'POST', body }),
  register: (body: { name: string; email: string; password: string }) =>
    api<AuthResponse>('/auth/register', { method: 'POST', body }),
  logout: () => api<{ message: string }>('/auth/logout', { method: 'POST' }),
  me: () => api<User>('/auth/me'),
  updateProfile: (body: { name: string }) => api<User>('/users/me', { method: 'PATCH', body }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api<{ message: string }>('/users/me/password', { method: 'PATCH', body }),
};
