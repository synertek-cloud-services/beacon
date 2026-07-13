import { reactive } from 'vue';
import { api, type CurrentUser, type Role } from './api';

const ROLE_RANK: Record<Role, number> = { readonly: 0, technician: 1, admin: 2 };

export const authState = reactive<{ user: CurrentUser | null }>({ user: null });

export async function loadCurrentUser(): Promise<void> {
  authState.user = await api.auth.me();
}

export function hasRole(min: Role): boolean {
  if (!authState.user) return false;
  return ROLE_RANK[authState.user.role] >= ROLE_RANK[min];
}
