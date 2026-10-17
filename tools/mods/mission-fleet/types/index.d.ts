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
  /**
   * The front's own folder, `<root>/fronts/<front>`: a clone the Controller has not pinned is told to
   * run here. Absent on a console staffed before clones were allowed, which clones nothing.
   */
  cloneHome?: string
  /**
   * The portfolio's fronts at staffing (each folder under `_command/portfolio` with a hub): a clone of
   * any repository lands one level under any of their folders, `<root>/fronts/<front>/<repo>`. Absent on
   * a console staffed while a clone landed only in its own front, which keeps that.
   */
  cloneFronts?: string[]
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
  /**
   * Set when a go or no-go was decided after the Controller that raised it stood down: the time it was
   * held for the next Controller staffed under the same call sign. Cleared once that Controller has it.
   */
  held?: string
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

/**
 * Each call sign's colour slot in the app, 0 to 7 for the tokens --slot-1 to --slot-8. Kept in the
 * plugin's store, so a Controller keeps its colour after a reload and in the next session; a
 * stood-down call sign keeps its entry, so the messages about it keep their colour.
 */
export type Slots = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'mission-fleet': { consoles: Console[]; audit: AuditEntry[]; reserving: Reservation[]; lineage: Lineage[]; loops: LoopEntry[]; poll: PollItem[]; pending: PendingAdvisory[]; pollSeq: number; watches: PrWatch[] }
  }
}
