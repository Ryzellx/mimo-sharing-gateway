export type Role = 'admin' | 'user';

export interface ApiErrorBody {
  error: { message: string; type: string; code: string };
}

const TOKEN_KEY = 'mimo_gw_token';
const ROLE_KEY = 'mimo_gw_role';
const USER_KEY = 'mimo_gw_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRole(): Role | null {
  return localStorage.getItem(ROLE_KEY) as Role | null;
}

export function getUsername(): string | null {
  return localStorage.getItem(USER_KEY);
}

export function saveSession(token: string, role: Role, username: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(USER_KEY, username);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? res.statusText);
  }
  return body as T;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const apiPatch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', body: JSON.stringify(body ?? {}) });
