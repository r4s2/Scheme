# Scheme

Find, host and run esports tournaments for Valorant, League of Legends, Overwatch and Marvel Rivals, with verified ranks, balanced teams, and an AI co-pilot for hosts.

The tournament engine and tournament operations are built and tested, and hosts and players can run an event end to end in the app. Sign-in, event creation, the agent, Discord and payments come next. The clickable prototype shows the full intended product.

## Try it

You need Node 20.18 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no database configured, the app runs on demo data kept in memory:

- **Friday Night Spike** (Valorant, live): an overdue match, an extension request, and open matches.
- **Saturday Six-Stack Social** (Marvel Rivals, check-in, $30 entry): two players haven't checked in and subs are waiting.

Use **Acting as** in the top bar to be the host (`kestrel`) or any player. Captains such as `glint` (Hot Coffee) and `lynx` (Backline Bandits) can report results. Things to try:

1. As `glint`, report Hot Coffee winning M4. As `lynx`, report the opposite. As `kestrel`, settle the dispute on the **Match desk**.
2. As `kestrel`, approve the extension request, forfeit the overdue match, edit the bracket, and enter results until there's a winner.
3. **Close** the event, optionally adding a prize, then switch to a winner and check **Notifications**.
4. On Saturday Six-Stack, replace a no-show with a sub, start it, play it out, close it, and claim a cash prize (claims unlock 24 hours after closing).

Demo data resets when the server restarts.

## What's here

| Path | What it is |
| --- | --- |
| `src/engine/` | Tournament engine: brackets for all five formats, results, disputes, seeding, team balancing, deadlines, publisher rules, prize math. Pure TypeScript. |
| `src/server/operations.ts` | Every tournament operation: check-in, start, results, reports, disputes, extensions, forfeits, bracket edits, close, cancel, payout claims, and background jobs. Pure functions with permission checks. |
| `src/server/store/` | Where tournaments are saved: in memory for the demo, or Postgres with version checks so simultaneous edits can't overwrite each other. |
| `src/server/views.ts` | Read-only views for pages, like the host's match desk. |
| `src/app/t/[id]/` | The tournament page and its server actions: host bracket, match desk, check-in, close, change log; player match page. |
| `src/app/demo` | `/demo`: the engine drawing every format from sample data. |
| `supabase/migrations/` | Database schema with row-level security. |
| `supabase/seed.sql` | Database sample data: Friday Night Spike. |
| `docs/` | Architecture, publisher rules, and open decisions. |

## With a database

1. Create a Supabase project, or run one locally with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase start`, which needs Docker).
2. Apply the schema and sample data: `supabase db reset` locally, or `supabase link` then `supabase db push` for a hosted project. Only seed development projects.
3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to the project's connection string. For Supabase, use a pooler string from **Connect** (Session pooler, or Transaction pooler on port 6543); the direct `db.<project>.supabase.co` address only works on IPv6 networks. Supabase connections are always encrypted.

In development, if the database can't be reached (for example, guest Wi-Fi that blocks database traffic), the app shows a notice and runs on demo data, then switches back on its own once the database answers. Changes to `.env.local` apply without restarting. Production never falls back: a missing database is an error.

## Checks

```bash
npm run check          # lint, typecheck, unit tests
npm run test:coverage  # coverage report
npm run build          # production build
TEST_DATABASE_URL=postgres://... npx vitest run src/server   # Postgres integration tests (throwaway database only)
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
