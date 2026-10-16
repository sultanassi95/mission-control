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

export type LoopEntry = { at: string; from: string; to: string; kind: 'status' | 'call' | 'decision' | 'advisory'; text: string }

export type PollItem = {
  id: string
  at: string
  from: string
  kind: 'gate' | 'advisory'
  title: string
  detail: string
  state: 'open' | 'go' | 'no-go' | 'superseded' | 'dismissed'
  /** The agent that raised it: a decision goes to this agent only. */
  agentId: string
  /** Set when a decision could not be delivered. */
  undelivered?: string
  /** When the app sent a decision on it to Flight; the gate takes no other tap until Flight runs it or the code expires. */
  sentAt?: string
  decidedAt?: string
  note?: string
  /** For an advisory: the fronts whose map names the changed scope. */
  targets?: string[]
}

export type PrWatch = { callSign: string; agentId: string; cwd: string; pr: number; sig?: string; since: string; fails?: number }

export type PendingAdvisory = { id: string; front: string; text: string; at: string }

export type AuditEntry = { at: string; op: string; target: string; result: string }

declare module 'claude-code' {
  interface PluginState {
    'mission-fleet': { consoles: Console[]; audit: AuditEntry[]; reserving: Reservation[]; lineage: Lineage[]; loops: LoopEntry[]; poll: PollItem[]; pending: PendingAdvisory[]; pollSeq: number; watches: PrWatch[] }
  }
}
