/**
 * Cliente HTTP. Nenhum segredo vive no frontend: a sessão administrativa é
 * um cookie HttpOnly e o token CSRF fica apenas em memória.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export function setCsrfToken(t: string | null) {
  csrfToken = t;
}

type Opts = { token?: string; signal?: AbortSignal };

async function request<T>(method: string, url: string, body?: unknown, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  if (url.startsWith('/api/admin') && method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  if (opts.token) headers['x-access-token'] = opts.token;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* resposta não-JSON */
  }
  if (!res.ok) {
    const err = new ApiError(
      res.status,
      String(data.code ?? 'ERROR'),
      String(data.error ?? 'Não foi possível concluir. Tente novamente.'),
      ((data.details as { fields?: Record<string, string> } | undefined)?.fields ?? {}) as Record<string, string>,
    );
    if (res.status === 401 && url.startsWith('/api/admin') && !url.endsWith('/login')) {
      window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: err.message }));
    }
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, opts?: Opts) => request<T>('GET', url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: Opts) => request<T>('POST', url, body ?? {}, opts),
  put: <T>(url: string, body?: unknown, opts?: Opts) => request<T>('PUT', url, body ?? {}, opts),
  patch: <T>(url: string, body?: unknown, opts?: Opts) => request<T>('PATCH', url, body ?? {}, opts),
  del: <T>(url: string, opts?: Opts) => request<T>('DELETE', url, undefined, opts),
  upload: <T>(url: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<T>('POST', url, fd);
  },
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
