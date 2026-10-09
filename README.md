# Scheme

Find, host and run esports tournaments for Valorant, League of Legends, Overwatch and Marvel Rivals, with verified ranks, balanced teams, and an AI co-pilot for hosts.

This repo is the start of the real app. The tournament engine is done and tested; the pages, sign-in, and the agent come next. The clickable prototype shows the intended product.

## What's here

| Path | What it is |
| --- | --- |
| `src/engine/` | The tournament engine: brackets for all five formats, results, disputes, seeding, team balancing, deadlines, publisher rules, and prize math. Pure TypeScript, no database or network. |
| `src/engine/__tests__/` | Engine tests (`npm test`). |
| `src/lib/db/` | Loads a tournament from Supabase and turns the rows into engine state. |
| `src/lib/supabase/` | Supabase clients for server, browser, and trusted server code. |
| `src/components/BracketView.tsx` | Read-only bracket for every format. |
| `src/app/demo` | `/demo`: the engine rendering sample data, no database needed. |
| `src/app/t/[id]` | `/t/<id>`: a real tournament loaded from Supabase. |
| `supabase/migrations/` | Database schema with row-level security. |
| `supabase/seed.sql` | Local sample data: a live 8-team Valorant event. |
| `docs/` | Architecture, publisher rules, and open decisions. |

## Run it

You need Node 20.18 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000/demo to see the engine draw a bracket. Switch formats with the buttons.

### With a database

1. Create a Supabase project, or run one locally with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase start`, which needs Docker).
2. Apply the schema and sample data:
   ```bash
   supabase db reset   # local: runs migrations, then seed.sql
   ```
   For a hosted project, use `supabase link` and `supabase db push`. Only seed a development project.
3. Copy `.env.example` to `.env.local` and fill in the Supabase URL and keys.
4. Open `/t/<id>` with a tournament id from the `tournaments` table.

## Checks

```bash
npm run check          # lint, typecheck, tests
npm run test:coverage  # engine coverage report
npm run build          # production build
```

CI runs all of these on every push and pull request.

## How the pieces fit

The engine is the single source of truth for tournament logic. The database stores only facts: teams, slot order, results, reports, deadlines. Matches, standings and champions are derived by the engine every time. Server code that changes anything runs the engine first, and only then writes with the service role. Clients read through row-level security. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Next up

1. Sign-in: Discord and email through Supabase Auth; Riot Sign On and Battle.net as account links.
2. Host flows: the setup wizard, bracket editing (swap, randomize, seed, transform), match desk, check-in.
3. Player flows: registration, match page, reporting, extensions, tickets.
4. Background jobs: auto-confirm reports, deadline reminders, payout release.
5. The Scheme Agent: a language model with tool calls into the engine, proposing changes for host approval.
6. Discord bot worker.
7. Payments, once the provider decision in [docs/DECISIONS.md](docs/DECISIONS.md) is made.
