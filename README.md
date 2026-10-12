# Scheme

Find, host and run esports tournaments for Valorant, League of Legends, Overwatch and Marvel Rivals, with verified ranks, balanced teams, and an AI co-pilot for hosts.

Hosts can set up an event with the creation wizard (with publisher name checks), take team or solo sign-ups, build balanced teams, and run the bracket on a live board through to prizes. Players have profiles with linked ranks, saved teams, tickets and announcements. Sign-in, the agent, Discord and payments come next.

## Try it

You need Node 20.18 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm run dev` recompiles pages as you open them, so the first visit to each page is slow; `npm run preview` builds the app and runs it the way it will run in production (still with the "Acting as" switcher), which is the fair way to judge speed.

With no database configured, the app runs on the sample data kept in memory: the same tournaments `npm run db:setup` loads into a database.

- **Browse:** search, game and format filters, and the tournament library: eight events taking sign-ups across all four games.
- **Leaderboards:** ranked by tournaments won, from forty closed events. The home page rotates through them.
- **Friday Night Spike** (Valorant, live): an overdue match, an extension request, and open matches.
- **Saturday Six-Stack Social** (Marvel Rivals, check-in, $30 entry): two players haven't checked in and subs are waiting.

Use **Acting as** in the top bar to be the host (`kestrel`) or any player. Captains such as `glint` (Hot Coffee) and `lynx` (Backline Bandits) can report results. Things to try:

1. **Host a tournament:** walk the wizard. Name a Marvel Rivals event "Saturday Night Cup" to see NetEase's name rules block it and suggest alternatives, then publish.
2. **Sign up:** as `glint`, open Ascendant Ladder Night and register Hot Coffee from the saved team in one step. As `zorra`, join Strategist Social solo.
3. **The live board:** as `kestrel` on Friday Night Spike, drag a first-round team onto another (or click one, then the other), randomize, auto-seed, change the format, or enter a result right on a match. Teams glide into place and save in the background, with Undo. Hover any team for its roster, ranks, karma and wins.
4. **Match desk:** as `glint`, report Hot Coffee winning M4; as `lynx`, report the opposite; as `kestrel`, settle the dispute and approve the extension request.
5. **Tickets and announcements:** as `glint`, open a ticket; as `kestrel`, reply and post an announcement. Watch the bell.
6. **Teams and profiles:** create a team on **Teams**, invite someone, switch to them and accept. Open any player's profile from a leaderboard.
7. **Close** an event, then switch to a player on the winning team (`ember` on Tilt Proof, say) for the winner popup.

Demo data resets when the server restarts.

## What's here

| Path | What it is |
| --- | --- |
| `src/engine/` | Tournament engine: brackets for all five formats, results, disputes, seeding, team balancing, deadlines, publisher rules, prize math. Pure TypeScript. |
| `src/server/operations.ts` | Every tournament operation: check-in, start, results, reports, disputes, extensions, forfeits, bracket edits, close, cancel, payout claims, and background jobs. Pure functions with permission checks. |
| `src/server/store/` | Where tournaments are saved: in memory for the demo, or Postgres with version checks so simultaneous edits can't overwrite each other. |
| `src/server/views.ts` | Read-only views for pages, like the host's match desk. |
| `src/app/` | Pages: browse (search, filters, library, leaderboard ticker), leaderboards, my tournaments, notifications, and `t/[id]`, the tournament page with its server actions: registration, bracket, match desk, check-in, close, change log, player match page. |
| `src/components/bracket/` | The bracket board: match cards, wires, status, team hover cards and drag-to-swap. |
| `src/server/create.ts` | The creation wizard's draft, its checks (publisher rules, schedule, setup), and publishing. |
| `src/server/registration.ts` | Team and solo sign-up with rank, verification and karma checks; building balanced teams from solo sign-ups. |
| `src/server/community.ts` | Announcements and help tickets. |
| `src/server/rosters.ts` | Saved teams: create, invite, accept, remove, hand over captaincy. |
| `src/server/summary.ts` | Library cards, leaderboards (tournaments won) and the people list, from stored tournaments. |
| `src/server/demo-data.ts` | Sample data for demo mode, and the source of `supabase/seed.sql`. |
| `src/app/demo` | `/demo`: the engine drawing every format from sample data. |
| `supabase/migrations/` | Database schema with row-level security. |
| `supabase/seed.sql` | Database sample data, generated from `src/server/demo-data.ts`. |
| `docs/` | Architecture, publisher rules, and open decisions. |

## With a database

1. Create a Supabase project, or run one locally with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase start`, which needs Docker).
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to the project's connection string. For Supabase, use a pooler string from **Connect** (Session pooler, or Transaction pooler on port 6543); the direct `db.<project>.supabase.co` address only works on IPv6 networks. Supabase connections are always encrypted.
3. Run `npm run db:setup`. It applies any schema changes the database doesn't have yet and loads the sample data, and it's safe to run again. `npm run db:setup -- --reset` empties every app table and reloads the sample data, for when you've played the samples out (development projects only). `npm run db:setup -- --no-seed` skips the sample data. (With a local Supabase, `supabase db reset` does the same.)

The sample data lives in `src/server/demo-data.ts`. After changing it, run `npm run seed:generate` to rewrite `supabase/seed.sql`; CI checks the two match.

In development, if the database can't be reached (for example, guest Wi-Fi that blocks database traffic), the app shows a notice and runs on demo data, then switches back on its own once the database answers. Changes to `.env.local` apply without restarting. Production never falls back: a missing database is an error.

## Checks

```bash
npm run check          # lint, typecheck, unit tests
npm run test:coverage  # coverage report
npm run build          # production build
TEST_DATABASE_URL=postgres://... npx vitest run src/server/__tests__/seed-parity.integration.test.ts   # seed.sql matches demo mode (fresh database)
TEST_DATABASE_URL=postgres://... npx vitest run src/server/__tests__/postgres.integration.test.ts     # store against Postgres (throwaway database only)
SCHEME_SQL_LOG=1 npm run dev   # print every query, to spot pages making too many round trips
```

CI runs all of these, including the integration tests against Postgres 16.

## How the pieces fit

Pages call server actions. Each action loads a tournament from the store, runs one operation (which checks permissions and uses the engine for all tournament logic), and saves the result with a version check. Operations return effects, an audit entry and notifications, which the store writes in the same transaction. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Next up

1. Sign-in with Supabase Auth (Discord and email), replacing the development "Acting as" switcher; Riot Sign On and Battle.net to link game accounts and verify ranks.
2. A background worker for reminders, auto-confirming reports, opening check-in on schedule and payout release (today these run when a tournament page is viewed).
3. The Scheme Agent, built on the operations here: it proposes changes and the host approves them.
4. Discord bot worker: announcements, match threads and check-in from Discord.
5. Payments, once the provider decision in [docs/DECISIONS.md](docs/DECISIONS.md) is made.
