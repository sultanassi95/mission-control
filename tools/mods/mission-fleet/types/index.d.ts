export type ConsoleStatus = 'staffing' | 'staffed' | 'stood-down'

export type Console = {
  callSign: string
  front: string
  name: string
  agentId: string
  cwd: string
  model: string
  staffedAt: string
  status: ConsoleStatus
}

export type AuditEntry = { at: string; op: string; target: string; result: string }

declare module 'claude-code' {
  interface PluginState {
    'mission-fleet': { consoles: Console[]; audit: AuditEntry[] }
  }
}
