export interface ApiError {
  message: string;
  status: number;
}

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `/api${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const error: ApiError = {
      message: body.message || body.error || res.statusText,
      status: res.status,
    };
    throw error;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get<T = unknown>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: 'GET' });
  },

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T = unknown>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: 'DELETE' });
  },
};
