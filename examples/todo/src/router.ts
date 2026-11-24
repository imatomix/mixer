import type { LoggerState } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import type { SessionState } from '@imatomix/mix-session'

export type SessionData = { userId: string; userName: string }
export type AppState = LoggerState & SessionState<SessionData>

// Routes are created outside mix(), so they take the app's state type here, once
export const { get, post, namespace } = createRouter<AppState>()
