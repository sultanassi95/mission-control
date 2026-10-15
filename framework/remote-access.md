# Remote access - the Mission Control App from anywhere

> The app runs on the founder's machine and listens on 127.0.0.1 only. Reaching
> it from a phone in another city goes through a private network that only the
> founder's own devices join. Nothing is exposed to the public internet, ever.

```mermaid
flowchart LR
  P["phone, any network<br/>Tailscale app on"] -->|"WireGuard, end to end"| M["the machine<br/>tailscale serve (HTTPS, tailnet only)"]
  M --> D["127.0.0.1:4777<br/>front door"]
  D -->|"/p/work/*"| A["one app server<br/>per Claude profile"]
  D -->|"/p/personal/*"| A2["another profile's server"]
  A <--> F["Flight<br/>via the mission-fleet mod"]
```

## What this protects and what it does not

| Layer | Holds against | Does not hold against |
|---|---|---|
| 127.0.0.1 bind | every other device on any network | a process on the same machine |
| Tailscale `serve` | anyone not signed into the founder's tailnet | a device the founder added to the tailnet |
| Tailnet sign-in | a request that does not come through `tailscale serve` on this Mac's own tailnet name, or that carries another Tailscale login | a same-user process that sets both headers itself |
| App token | other local web pages, other browsers, a stale link | a same-user process that reads the token file or the session transcript where the link was printed |
| Fleet guard | Controllers and their back rooms reaching the app's ports (4777 to 4797) or naming the app's home (`~/.mission-control`: the token and the profile registry) in a command or a tool call | a path spelled so the guard cannot see it (a glob, a variable built in steps), and a script file an agent writes and runs later (see the guard's header); a same-user process outside the fleet can read the token file |

## How a request is let in

A data request to the app (`/op`, `/events`, `/state.json`, `/flights.json`,
uploads, `/p/*`) is accepted on either of two proofs:

- **Tailnet sign-in.** A request that arrives through `tailscale serve` on this
  Mac's own tailnet name carries the viewer's Tailscale login, and `serve` sets
  that header itself. When the login is the owner's, no token is needed. The
  server reads the owner's login and this Mac's tailnet name once from the local
  Tailscale client; with Tailscale absent, the token is the only way in. Funnel
  requests carry no login.
- **The app token.** One persistent token, kept at `~/.mission-control/app-token`
  (mode 0600) and shared by every profile's server. The first server writes it,
  the rest read it, and it survives restarts. Revoke it by deleting the file and
  restarting every profile's app; the next start issues a new one.

The Host header must be loopback or a Tailscale name, and a POST must come from
the page's own origin.

## One front door, one server per profile

Each Claude profile (work, personal, and so on) runs its own app server. They all
try to hold port 4777; whichever holds it is the front door, serves the page and
routes `/p/<profile>/*` to that profile's server, so the door survives any one
session closing. Switch profiles from the app header. All of them share the one
token.

Once `/console app` has run, the app is a standing setting for the profile: every
session starts it and a supervisor restarts it when the server dies.
`/console app stop` turns that off.

## What the app does

- Shows the fleet, the Poll gates and the loops, and sends prompts, commands and
  console operations to Flight.
- **Answers Flight's questions.** While the app runs, a question Flight would ask
  at the terminal goes to the app instead (and raises a phone alert). Answer it
  there, or at the Mac with `/console answer`. Without the app the terminal
  dialog is used.
- **Photos.** A photo attached in the app is stored under `_command/fleet/uploads`
  so the session can read it. Photos are pruned after 7 days, and the folder
  never holds more than 200 photos or 256 MB (oldest first).

## One-time setup

1. **The machine.** Install Tailscale (`brew install --cask tailscale` or the App
   Store), open it, sign in. In the admin console: turn on **MagicDNS** and
   **HTTPS certificates**, and **disable key expiry** for this machine so it does
   not drop off the tailnet while the founder is away.
2. **The account.** Two-factor authentication on the identity the tailnet signs
   in with. Optional and stronger: **Tailnet Lock**, so a new device needs an
   existing device's approval.
3. **The phone.** Install the Tailscale app, sign in with the same account, and
   turn the VPN on. Only one VPN runs at a time on iOS.

## Each time

1. At the terminal: `/console app` starts the app and prints its link. This is
   needed once; after that the app is always on for the profile.
2. Serve it to the tailnet: `tailscale serve --bg 4777` (the port the link
   names). The HTTPS name is `https://<machine>.<tailnet>.ts.net`.
3. On the phone: open `https://<machine>.<tailnet>.ts.net/`. Signed in to the
   founder's Tailscale login, it needs no token. If it asks for one, open
   `https://<machine>.<tailnet>.ts.net/?t=<token>` once; the page keeps the token
   in its own storage and drops it from the address bar. Add it to the home
   screen for a full-screen app.

The machine must stay awake and online: `caffeinate -dis` beside the session, on
power. A lid-closed Mac sleeps unless it is on power with an external display.

## Phone alerts

When a Controller's report opens a gate, the mission-fleet mod sends one line
through Claude Code's notification tool. It reaches the phone only while
**Remote Control** is connected to this session; otherwise it is a desktop
notification, and the tool skips it entirely while the founder is at the
terminal. The audit log records which (`alert ... -> Mobile push not sent
(Remote Control inactive)`). The app's Poll badge shows the same gate either way.

## Never

- **Never `tailscale funnel`.** Funnel publishes to the public internet; this
  app can start agents and answer go/no-go gates.
- **Never ngrok or any tunnel without its own login in front.**
- **Never bind the server to 0.0.0.0** or a LAN address.

## Kill switches

| From | Do | Effect |
|---|---|---|
| The app | menu, then "Stop the app server" | the server stops; the link dies |
| The app | menu, then "Dismiss every console" | every Controller ends, nothing written |
| The terminal | `/console app stop` | the server stops |
| The phone, without the app | turn the Tailscale VPN off, or remove the device in the admin console | remote access ends at once |
| The machine | `tailscale serve reset` | the tailnet route is removed |

## Base branches: the control that holds

The fleet guard catches a Controller pushing to a base or deploy branch; it is a
text guard and not a sandbox. The control that holds is server-side branch
protection with administrators included, because Controllers push with the
founder's credentials:

- required pull request before merging (0 approvals for a solo founder);
- **include administrators** on; force pushes and deletions blocked.

Private repositories need a paid plan for branch protection (GitHub Pro for a
personal account, Team for an organization). Record each repo's state in its
spoke; a repo without protection is one where a Controller's push guard is the
only line.
