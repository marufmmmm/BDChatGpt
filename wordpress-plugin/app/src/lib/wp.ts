/**
 * Thin client for the BD ChatGPT WordPress REST API.
 * WordPress injects window.BDCHAT (restUrl, nonce) on every page that loads the app.
 */
type BootData = { restUrl: string; nonce: string; loginUrl: string; logoutUrl: string };

declare global {
  interface Window { BDCHAT?: BootData }
}

function boot(): BootData {
  return window.BDCHAT ?? { restUrl: '/wp-json/bdchat/v1/', nonce: '', loginUrl: '/', logoutUrl: '/' };
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Start a streaming request. The caller reads the response body as it arrives. */
export function wpStream(path: string, body: unknown): Promise<Response> {
  const cfg = boot();
  return fetch(cfg.restUrl + path.replace(/^\//, ''), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
    body: JSON.stringify(body),
  });
}

export async function wpRequest<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const cfg = boot();
  const res = await fetch(cfg.restUrl + path.replace(/^\//, ''), {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-WP-Nonce': cfg.nonce,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((json as { message?: string }).message ?? `Request failed (${res.status})`, res.status, json);
  }
  return json as T;
}

/** Called after login or register: WordPress issues a new REST nonce for the new session. */
export function setNonce(nonce: string): void {
  if (window.BDCHAT && nonce) window.BDCHAT.nonce = nonce;
}

export function logoutUrl(): string {
  return boot().logoutUrl;
}
