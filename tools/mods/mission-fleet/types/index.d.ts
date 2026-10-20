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

/** One answer a Controller offers the founder: its label, and what choosing it does. */
export type DecisionOption = { label: string; does?: string }

export type PollItem = {
  id: string
  at: string
  from: string
  /**
   * question: a decision the Controller asked, with its own options. gate: a report's blocked line
   * with no decisions block (a Controller staffed before questions), asked as Go or No-go.
   * advisory: a contract change naming dependent fronts, asked as Tell them or Don't tell.
   * todo: an action only the founder can take; never asked, checked off with Done, which is told to the Controller.
   * Every asked kind reaches the founder as one of Flight's own questions (AskUserQuestion).
   */
  kind: 'gate' | 'advisory' | 'question' | 'todo'
  title: string
  detail: string
  /** answered: a question's option was chosen (choice names it; 0 for the founder's own words, in note). done: a to-do was checked off. */
  state: 'open' | 'go' | 'no-go' | 'answered' | 'done' | 'superseded' | 'dismissed'
  /** A question's options as the Controller wrote them. */
  options?: DecisionOption[]
  /** The option the founder chose, counted from 1. */
  choice?: number
  /** The agent that raised it: an answer goes to this agent only. */
  agentId: string
  /** When the fleet last put it to Flight to ask; put again after ASK_AGAIN while still open. */
  askedAt?: string
  /** The Controller wrote it `urgent:`: asked before older questions. */
  urgent?: true
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
