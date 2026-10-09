# Architecture

## Principles

- **The engine decides; the database remembers.** `src/engine` derives matches, standings, champions, deadlines and prizes from stored facts. Nothing derived is stored, so the bracket can't drift out of sync with its results.
- **Trusted writes only.** Anything that changes a tournament, a result, a rank, karma or money goes through server code that checks permissions, runs the engine, and then writes with the service role. Row-level security gives clients read access only (plus marking their own notifications read and editing their own profile).
- **Money in cents.** Prize math uses integers; leftover cents go to higher places so every cent in the pool is paid.
- **Scheme never holds a balance.** Payment and payout rows mirror what the payment provider holds and moves.
- **The agent proposes, the host approves.** The Scheme Agent calls engine functions to build proposals. Nothing applies until the host confirms, and every change is written to `audit_log`.

## Engine modules

| Module | Responsibility |
| --- | --- |
| `bracket.ts` | Builds brackets for single and double elimination, round robin, Swiss, and groups → playoffs. Standings, playable matches, and whether a result can still be edited. |
| `results.ts` | Records and reopens results with validation; compares captain reports (confirm or dispute). |
| `seeding.ts` | Locked slots, randomize, seed by rank, swaps, and whether the format can still change. |
| `balance.ts` | Builds teams from solo sign-ups (even teams or rank tiers) and ranks substitutes. |
| `schedule.ts` | Wave deadlines, extensions, match status, auto-confirm and payout release times. |
| `compliance.ts` | Publisher naming rules and money rules for Riot, Blizzard and NetEase. |
| `payouts.ts` | Final places (bracket, pick, co-winners, standings), prize splits, per-player shares, tax-form threshold. |
| `games.ts` | Game ladders, roles and rank names. |

## Result keys

A match result is stored under the engine's `resultKey`: the two team ids sorted by code point and joined with `|`, prefixed by stage when two teams could meet again (`L:` lower bracket, `GF:` grand final, `P:` playoffs). In SQL, sort with `collate "C"` to match JavaScript's sort.

## Planned runtime

- **Web app:** Next.js on Vercel.
- **Database, auth, realtime, storage:** Supabase.
- **Workers** on a small always-on host:
  - the Discord bot (a serverless function can't hold Discord's gateway connection);
  - a job runner for deadline reminders, auto-confirming reports after 12 hours, and releasing payouts after the dispute window.
- **Scheme Agent:** a language model with tools that call the engine and propose changes; conversations are stored in `agent_messages`.
