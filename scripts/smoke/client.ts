// Thin HTTP client for the smoke suite. Auth is a plain
// `Authorization: Bearer <token>` header (see lib/auth.ts + POST /api/auth/login),
// not a cookie — this matches how the app itself expects tokens to be sent.
export interface SmokeResponse {
  status: number
  // Response bodies are arbitrary JSON from many different API routes —
  // no shared schema to type against, so callers narrow per-check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

export interface SmokeClient {
  setToken(token: string): void
  get(path: string): Promise<SmokeResponse>
  post(path: string, data?: unknown): Promise<SmokeResponse>
}

export function makeClient(baseUrl: string, protectionBypassSecret?: string): SmokeClient {
  let token: string | null = null

  async function request(path: string, init: RequestInit): Promise<SmokeResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {}),
    }
    if (token) headers.Authorization = `Bearer ${token}`
    // Preview deployments sit behind Vercel's own SSO wall (Deployment
    // Protection) — this header is Vercel's documented bypass for exactly
    // this case (automated checks with no browser session to satisfy SSO).
    if (protectionBypassSecret) headers['x-vercel-protection-bypass'] = protectionBypassSecret

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null
    try {
      body = await res.json()
    } catch {
      // non-JSON response (e.g. empty body) — leave body as null
    }
    return { status: res.status, body }
  }

  return {
    setToken(t: string) {
      token = t
    },
    get: (path: string) => request(path, { method: 'GET' }),
    post: (path: string, data?: unknown) =>
      request(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  }
}
