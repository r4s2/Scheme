# Scheme

Find, host and run esports tournaments for Valorant, League of Legends, Overwatch and Marvel Rivals, with verified ranks, balanced teams, and an AI co-pilot for hosts.

The tournament engine and tournament operations are built and tested, and hosts and players can run an event end to end in the app. Sign-in, event creation, the agent, Discord and payments come next. The clickable prototype shows the full intended product.

## Try it

You need Node 20.18 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no database configured, the app runs on the sample data kept in memory: the same tournaments `npm run db:setup` loads into a database.

- **Browse:** search, game and format filters, and the tournament library: eight events taking sign-ups across all four games.
- **Leaderboards:** ranked by tournaments won, from forty closed events. The home page rotates through them.
- **Friday Night Spike** (Valorant, live): an overdue match, an extension request, and open matches.
- **Saturday Six-Stack Social** (Marvel Rivals, check-in, $30 entry): two players haven't checked in and subs are waiting.

Use **Acting as** in the top bar to be the host (`kestrel`) or any player. Captains such as `glint` (Hot Coffee) and `lynx` (Backline Bandits) can report results. Things to try:

1. Hover any team in a bracket to see its roster, ranks, karma and wins. As the host, drag a first-round team onto another to swap them.
2. As `glint`, report Hot Coffee winning M4. As `lynx`, report the opposite. As `kestrel`, settle the dispute on the **Match desk**.
3. As `kestrel`, approve the extension request, forfeit the overdue match, and enter results until there's a winner.
4. **Close** the event, then switch to a player on the winning team (`ember` on Tilt Proof, say) for the winner popup, and check the bell.
5. On Saturday Six-Stack, replace a no-show with a sub, start it, play it out, close it, and claim a cash prize (claims unlock 24 hours after closing).

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

1. Sign-in with Supabase Auth (Discord and email), replacing the development "Acting as" switcher; Riot Sign On and Battle.net as account links.
2. Event creation (the setup wizard with publisher checks) and registration.
3. A background worker for auto-confirming reports, reminders and payout release (today these run when a tournament page is viewed).
4. The Scheme Agent, built on the operations here: it proposes operations and the host approves them.
5. Discord bot worker.
6. Payments, once the provider decision in [docs/DECISIONS.md](docs/DECISIONS.md) is made.
