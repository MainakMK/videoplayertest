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

// Resolve the configured Player domain into a full origin (e.g. `https://play.example.com`).
// Every embed / direct-link URL shown in the Dashboard must be built from this — never
// from window.location.origin — so videos are always served from the dedicated player
// host, not the admin dashboard host. If Player domain is unset, falls back to the
// current dashboard origin so local dev still produces a clickable URL.
let playerBasePromise: Promise<string> | null = null;
export function getPlayerBase(): Promise<string> {
  if (!playerBasePromise) {
    playerBasePromise = (async () => {
      try {
        const data = await api.get<{ settings: Record<string, { value?: string }> }>('/settings/');
        const raw = (data.settings?.domain_player?.value || '').trim().replace(/\/+$/, '');
        if (raw) return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      } catch { /* fall through to origin */ }
      return typeof window !== 'undefined' ? window.location.origin : '';
    })();
  }
  return playerBasePromise;
}
export function invalidatePlayerBase(): void { playerBasePromise = null; }
