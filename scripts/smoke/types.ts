import type { SmokeClient } from './client'
import type { SmokeUser } from './auth'

export interface SmokeContext {
  client: SmokeClient
  user: SmokeUser
  readonly: boolean
  baseUrl: string
}

export interface SmokeOutcome {
  status: 'pass' | 'fail' | 'skip'
  message?: string
}

export type SmokeCheck = (ctx: SmokeContext) => Promise<SmokeOutcome>
