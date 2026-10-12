"use client";

import { useMemo, useState } from "react";
import { FORMAT_NAMES, GAMES, type FormatId, type GameId } from "@/engine";
import { SearchIcon } from "@/components/ui/icons";
import { TournamentCard } from "./TournamentCard";
import { fitsRank } from "./cards";
import type { Card } from "./types";

interface Filters {
  q: string;
  game: GameId | "all";
  format: FormatId | "all";
  signup: "all" | "team" | "solo";
  price: "all" | "free" | "paid";
  /** "all", "mine" (fits the viewer's own rank in each game), or a tier index in the chosen game. */
  rank: string;
}
const EMPTY: Filters = { q: "", game: "all", format: "all", signup: "all", price: "all", rank: "all" };

/** Search bar, filters and the tournament library. Filtering happens instantly in the browser. */
export function Library({ cards, hero, aside, myRanks = {} }: { cards: Card[]; hero: React.ReactNode; aside: React.ReactNode; myRanks?: Partial<Record<GameId, number>> }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (f.game === "all" || c.game === f.game) &&
        (f.format === "all" || c.format === f.format) &&
        (f.signup === "all" || c.signupType === f.signup) &&
        (f.price === "all" || (f.price === "free" ? !c.entryFeeCents : c.entryFeeCents > 0)) &&
        fitsRank(c, f.rank, myRanks) &&
        (!q || [c.name, c.host, GAMES[c.game].name, c.formatName, c.region].join(" ").toLowerCase().includes(q)),
    );
  }, [cards, f, myRanks]);
  const haveRanks = Object.keys(myRanks).length > 0;


  return (
    <>
      <section className="home-top">
        <div className="hero">
          {hero}
          <label className="searchbar">
            <SearchIcon />
            <input type="search" placeholder="Search by tournament, host or game" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search tournaments" />
          </label>
          <div className="filters">
            <select
              aria-label="Game"
              value={f.game}
              // Tiers belong to one game, so a tier filter resets when the game changes.
              onChange={(e) => setF((x) => ({ ...x, game: e.target.value as Filters["game"], rank: x.rank === "mine" ? "mine" : "all" }))}
            >
              <option value="all">All games</option>
              {(Object.keys(GAMES) as GameId[]).map((g) => (
                <option key={g} value={g}>
                  {GAMES[g].name}
                </option>
              ))}
            </select>
            <select aria-label="Format" value={f.format} onChange={(e) => set("format", e.target.value as Filters["format"])}>
              <option value="all">Any format</option>
              {(Object.keys(FORMAT_NAMES) as FormatId[]).map((k) => (
                <option key={k} value={k}>
                  {FORMAT_NAMES[k]}
                </option>
              ))}
            </select>
            <select aria-label="Sign-up type" value={f.signup} onChange={(e) => set("signup", e.target.value as Filters["signup"])}>
              <option value="all">Teams or solo</option>
              <option value="team">Team sign-up</option>
              <option value="solo">Solo sign-up</option>
            </select>
            <select aria-label="Rank" value={f.rank} onChange={(e) => set("rank", e.target.value)} title="Events without a rank range match every rank">
              <option value="all">Any rank</option>
              {haveRanks && <option value="mine">Fits my rank</option>}
              {f.game !== "all" &&
                GAMES[f.game].tiers.map((t, i) => (
                  <option key={t} value={String(i)}>
                    {t}
                  </option>
                ))}
            </select>
            <select aria-label="Entry" value={f.price} onChange={(e) => set("price", e.target.value as Filters["price"])}>
              <option value="all">Free or paid</option>
              <option value="free">Free</option>
              <option value="paid">Paid entry</option>
            </select>
          </div>
        </div>
        {aside}
      </section>
      <section>
        <div className="lib-head">
          <h2>Tournament library</h2>
          <span className="muted small" aria-live="polite">
            {shown.length} open
          </span>
        </div>
        <div className="lib-grid">
          {shown.length ? (
            shown.map((c) => <TournamentCard key={c.id} c={c} />)
          ) : (
            <div className="empty" style={{ gridColumn: "1 / -1" }}>
              {cards.length ? "No open tournaments match those filters." : "No open tournaments right now."}
              {cards.length > 0 && (
                <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => setF(EMPTY)}>
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
