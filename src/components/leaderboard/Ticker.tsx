"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Board } from "@/server/summary";
import { BoardList } from "./BoardList";

/** Home page leaderboard: rotates through the boards every six seconds; pauses on hover or focus. */
export function Ticker({ boards, missing }: { boards: Board[]; missing: string[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (paused || boards.length < 2) return;
    const t = setTimeout(() => {
      setI((x) => (x + 1) % boards.length);
      setCycle((c) => c + 1);
    }, 6000);
    return () => clearTimeout(t);
  }, [paused, boards.length, i, cycle]);

  const b = boards[i];
  return (
    <aside
      className={`card ticker ${paused ? "paused" : ""}`}
      aria-label="Leaderboard"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="ticker-head">
        <h2>Leaderboard</h2>
        <span className="tiny muted">Ranked by tournaments won</span>
      </div>
      {b ? (
        <>
          <div className="lbtabs" role="tablist">
            {boards.map((x, j) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                className="lbtab"
                aria-selected={j === i}
                onClick={() => {
                  setI(j);
                  setCycle((c) => c + 1);
                }}
              >
                {x.label}
              </button>
            ))}
          </div>
          <div className="lb-anim" key={`${b.key}-${cycle}`}>
            <BoardList rows={b.rows} limit={5} players={b.kind === "player"} />
          </div>
          <div className="progress" key={`p-${b.key}-${cycle}`}>
            <span />
          </div>
        </>
      ) : (
        <p className="small muted">The leaderboard fills in as tournaments close.</p>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="tiny muted">{missing.length ? `${missing.join(" and ")} join${missing.length === 1 ? "s" : ""} after ${missing.length === 1 ? "its" : "their"} first completed tournament.` : ""}</p>
        <Link href="/teams" className="btn xs">
          Full leaderboards
        </Link>
      </div>
    </aside>
  );
}
