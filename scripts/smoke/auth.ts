import type { SmokeClient } from './client'

export interface SmokeUser {
  id: string
  name: string
  email: string
  role: string
  outletId?: string
}

export async function login(client: SmokeClient, email: string, password: string): Promise<SmokeUser> {
  const res = await client.post('/api/auth/login', { email, password })
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  client.setToken(res.body.token)
  return { ...res.body.user, outletId: res.body.user.outlet?.id }
}
