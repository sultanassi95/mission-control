export type ConsoleStatus = 'staffing' | 'staffed' | 'stood-down'

export type Console = {
  callSign: string
  front: string
  project?: string
  name: string
  agentId: string
  cwd: string
  budget: number
  /** Branches this console never pushes to: the spoke base branches, beyond the always-protected list. */
  protectedBranches: string[]
  model: string
  /** Set by /console retune or staff --effort; applied on each of the Controller's model requests. */
  tune?: { model?: string; effort?: string }
  /** What the Controller's last request actually ran on, as `model effort`. */
  applied?: string
  staffedAt: string
  status: ConsoleStatus
}

export type Lineage = { agentId: string; parentId: string }

export type Reservation = { controller: string; token: string; at: number }

export type AuditEntry = { at: string; op: string; target: string; result: string }

declare module 'claude-code' {
  interface PluginState {
    'mission-fleet': { consoles: Console[]; audit: AuditEntry[]; reserving: Reservation[]; lineage: Lineage[] }
  }
}
