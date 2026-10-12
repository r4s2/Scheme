# Architecture

## Principles

- **The engine decides; the database remembers.** `src/engine` derives matches, standings, champions, deadlines and prizes from stored facts. Nothing derived is stored, so the bracket can't drift out of sync with its results.
- **One operation, one save.** Every change is a pure function in `src/server/operations.ts` that takes a tournament and a request and returns the new tournament plus effects (audit entries and notifications). Pages never change data any other way.
- **Permissions live in operations.** Each operation checks who is acting (host, captain in the match, player on a team) before doing anything, so every caller gets the same rules.
- **Simultaneous edits are safe.** Stores save with the version they loaded and refuse stale saves, so two hosts, or a host and a background job, can't silently overwrite each other.
- **Trusted writes only.** Server code writes through the store with full database access, after an operation has checked permissions. Row-level security gives browsers read access only.
- **Money in cents.** Prize math uses integers; leftover cents go to higher places so every cent in the pool is paid.
- **Scheme never holds a balance.** Payment and payout rows mirror what the payment provider holds and moves.
- **The agent will propose, the host approves.** The Scheme Agent will produce operation requests from this same list; nothing applies until the host confirms, and every change is logged.

## Request flow

```
form (server action) → store.get(id) → operation(agg, ctx, request) → store.commit(prev, outcome) → redirect with message
```

`ctx` carries the time, the actor and an id generator, so operations are deterministic and easy to test.

## Modules

| Module | Responsibility |
| --- | --- |
| `engine/bracket.ts` | Brackets for single and double elimination, round robin, Swiss, and groups → playoffs; standings; whether a result can still change. |
| `engine/results.ts` | Recording and reopening results; comparing captain reports. |
| `engine/seeding.ts` | Locked slots, randomize, seed by rank, swaps, format changes. |
| `engine/balance.ts` | Teams from solo sign-ups; substitute ranking. |
| `engine/schedule.ts` | Wave deadlines, extensions, match status, auto-confirm and payout release times. |
| `engine/compliance.ts` | Publisher naming and money rules. |
| `engine/payouts.ts` | Final places, prize splits, per-player shares, tax-form threshold. |
| `server/operations.ts` | Tournament operations (check-in, results, disputes, extensions, bracket edits, closing) and background jobs. |
| `server/create.ts`, `server/registration.ts`, `server/community.ts` | Publishing from the wizard; sign-ups and team balancing; announcements and tickets. Same pattern: pure operations on the tournament. |
| `server/rosters.ts` | Saved teams, outside any one tournament. |
| `server/views.ts` | Match desk and other read-only views. |
| `server/summary.ts` | Library cards, leaderboards and the people list. Postgres computes the same in SQL (one query each); the seed parity test keeps the two in step. |
| `server/data.ts` | Per-request cached reads shared by the header and pages, so each runs once per page. |
| `server/store/memory.ts` | In-memory store for the demo and tests. |
| `server/store/postgres.ts` | Postgres store; one transaction per save. |
| `server/store/fallback.ts` | Development only: uses the database when it answers and demo data when it doesn't, reconnecting on its own. |
| `server/session.ts` | Who is acting. Development uses the "Acting as" switcher until Supabase Auth is wired in. |

## Pages and data

Pages are server components that read through the store; the interactive parts (search and filters, the leaderboard ticker, the bracket board, the wizard, the notifications menu, the winner popup) are client components that get ready-to-render data as props.

Forms run in place: each calls a server action that runs one operation, saves, and returns a message (shown as a notice) while the page's data refreshes without navigating. The bracket board goes further: it computes a move with the same engine functions the server uses, shows it straight away (teams animate to their new spots), and saves in the background with the version it started from. If someone else saved first, the server refuses and the board settles on what's stored. Listing a tournament never loads the whole tournament: the library, leaderboards and "Acting as" list each come from one query.

## Result keys

A match result is stored under the engine's `resultKey`: the two team ids sorted by code point and joined with `|`, prefixed by stage when two teams could meet again (`L:` lower bracket, `GF:` grand final, `P:` playoffs). In SQL, sort with `collate "C"` to match JavaScript's sort.

## Planned runtime

- **Web app:** Next.js on Vercel.
- **Database, auth, realtime, storage:** Supabase.
- **Workers** on a small always-on host: the Discord bot, and a job runner calling `runDueJobs` for reminders, auto-confirming reports and releasing payouts.
- **Scheme Agent:** a language model whose tools are the operations above, run as proposals for host approval.
