export const CONTROLLER_TYPE = 'controller'

export const DEFAULT_BUDGET = 4

/** Model aliases a console takes, and the ids a request names. */
export const MODEL_IDS: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const CONTROLLER_PROMPT = [
  'You are a Controller in a mission-control portfolio. Flight, the orchestrator session, staffed you on one console: one front, or one project of a front. You own that scope until Flight stands you down.',
  '',
  'How you work:',
  '- Start cold from your scope\'s own files, named in your staffing order: the front hub, the spoke(s), progress.md. Read them before acting; they are your memory, not this conversation.',
  '- Use any skill, plugin or MCP the session has. Delivery work runs through the mission-control skills (/mission-flow, /epic-flow) exactly as their text says.',
  '- Your back room: you may dispatch your own sub-agents, within the budget in your staffing order. Beyond it, ask Flight first.',
  '- Credentials: read only env files inside your own scope\'s repos. Never open another front\'s env file or secrets.',
  '- Git: inside your scope you may commit, push your own feature branches and open PRs. Never merge, never push a base or deploy branch, never stash, never force-push.',
  '- Shared portfolio files are Flight\'s to write: never edit _command/trackers/fronts.md or _command/daily/today.md. Your own front\'s progress.md and ticket folders are yours.',
  '- You cannot ask the founder directly. Anything that needs the founder goes into "blocked on you".',
  '',
  'Every reply to Flight is a status check, exactly four lines and nothing else unless Flight asks for more:',
  'state: <one line>',
  'shipped: <one line, or nothing>',
  'blocked on you: <one line, or nothing>',
  'next: <one line>',
  'When Flight asks for one line, answer in one line. Then stop and wait to be called again.',
].join('\n')

export type StaffingOrder = {
  front: string
  project?: string
  callSign: string
  root: string
  hub: string
  spokes: string[]
  cwd: string
  budget: number
}

export function staffingOrder(o: StaffingOrder): string {
  const scope = o.project ? `project "${o.project}" of front "${o.front}"` : `front "${o.front}"`
  return [
    `Staffing order: you are on the ${o.callSign} console, owning the ${scope}.`,
    `Portfolio root: ${o.root}`,
    `Hub: ${o.hub}`,
    `Spoke(s): ${o.spokes.length ? o.spokes.join(', ') : 'none found - read the hub for where the work lives'}`,
    `Your working directory: ${o.cwd}`,
    `Back-room budget: up to ${o.budget} sub-agents in flight without asking Flight.`,
    'First task: read the hub, the spoke(s) and progress.md, then send your first status check.',
  ].join('\n')
}

/** A frontmatter field of a spoke, as written after `<field>:`. */
export function spokeField(text: string, field: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  const line = fm?.split('\n').find(l => l.startsWith(`${field}:`))
  return line?.slice(field.length + 1).trim() || undefined
}

/** The repo path a spoke records: the first token after `path:` in its frontmatter. */
export function spokePath(text: string): string | undefined {
  return spokeField(text, 'path')?.split(/\s+/)[0] || undefined
}

/** A spoke path the portfolio can resolve: relative, with no `..` segment. */
export function isInsideRelative(path: string): boolean {
  return !path.startsWith('/') && !path.split('/').includes('..')
}

/** The deepest directory every path shares; '' when they share none. */
export function commonDir(paths: string[]): string {
  if (paths.length === 0) return ''
  const split = paths.map(p => p.replace(/\/+$/, '').split('/'))
  const first = split[0] ?? []
  let n = first.length
  for (const parts of split) {
    let i = 0
    while (i < n && parts[i] === first[i]) i++
    n = i
  }
  if (paths.length === 1) return first.join('/')
  return first.slice(0, n).join('/')
}
