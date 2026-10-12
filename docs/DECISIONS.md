# Open decisions

Research and sources are in the "Scheme — Launch Blockers and Options" doc. Summary as of October 9, 2026:

| Decision | Recommended | Status |
| --- | --- | --- |
| Payment processor | PayPal skill-gaming pre-approval. Stripe's US policy prohibits video game tournaments with cash prizes. | Open. Paid events stay off until decided. |
| Legal review | Fixed-scope review by a gaming lawyer: blocked states, fund flow, terms. | Open |
| Paid-event state blocklist | Strictest common list until counsel signs off. | Open |
| Riot data | Apply for a production key using the prototype. | Open |
| Overwatch data | Battle.net sign-in for ownership; self-hosted OverFast for public ranks. | Open |
| Marvel Rivals data | Screenshot verification at launch; seek a data provider agreement. | Open |
| Discord | Slash commands first; apply for Message Content before 10,000 users. | Open |
| Build stack | Next.js + Supabase with two workers. | Done: this repo. |

# Roster rules by game

Researched October 12, 2026 from official rulebooks (Esports World Cup 2026, VCT Champions 2024, OWCS 2024, Marvel Rivals Ignite 2026 and Championship Season 7, PlayVS College). Config lives in `src/engine/games.ts`.

| Game | Starters | Starting roles | Subs (default limit) | Notes |
| --- | --- | --- | --- | --- |
| League of Legends | 5 | Locked: Top, Jungle, Mid, Bot, Support | 2 | One per position by convention; Scheme holds teams to it. Subs can be listed as Fill. |
| Overwatch | 5 (6 for 6v6) | Locked: 1 Tank, 2 Damage, 2 Support (6v6: 2-2-2) | 3 | Role queue / role lock enforces this in competitive play. OWCS allows up to 8 players. |
| Valorant | 5 | Open: Duelist, Initiator, Controller, Sentinel, Flex | 2 | Agents are free pick; no composition rule anywhere. |
| Marvel Rivals | 6 | Open: Vanguard, Duelist, Strategist, Flex | 2 | No role queue in game or official events. Ignite allows 6 + 2. |

- Hosts pick the sub limit per event (0 to 4); the game's default is preselected.
- A sub's listed role is their usual one. They can play any role on the day, so it's never checked against what they play.
- Subs are display only: check-in, ranks and prize shares use the starters. Wins on the leaderboards credit the whole registered roster, subs included.
- Everyone a captain lists confirms from a notification. Unconfirmed or declined players don't block check-in; the host sees them flagged and can swap in a free agent.

# Rank ranges

A host picks one of three: no range (default), a suggested range (shown on the listing and used by the rank filter, not enforced), or a required range (enforced at sign-up, as before). Existing events keep the required range they were published with.
