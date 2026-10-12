"use client";

import { useState } from "react";
import type { Board } from "@/server/summary";
import { BoardList } from "./BoardList";

/** Full leaderboards: pick a board on the left, filter by name. */
export function Boards({ boards, missing }: { boards: Board[]; missing: string[] }) {
  const [i, setI] = useState(0);
  const [q, setQ] = useState("");
  const b = boards[Math.min(i, boards.length - 1)];
  if (!b) return <div className="empty">The leaderboards fill in as tournaments close.</div>;
  const rows = b.rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="lbpage">
      <nav className="card lbside" aria-label="Boards">
        {boards.map((x, j) => (
          <button key={x.key} type="button" aria-current={j === i} onClick={() => setI(j)}>
            <span>{x.label}</span>
            <span className="mono tiny">{x.rows.length}</span>
          </button>
        ))}
        {missing.map((m) => (
          <button key={m} type="button" disabled style={{ opacity: 0.5, cursor: "default" }}>
            <span>{m}</span>
            <span className="tiny">No events yet</span>
          </button>
        ))}
      </nav>
      <div className="card panel" style={{ margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: 17 }}>{b.label}</h3>
          <input type="search" placeholder={`Find a ${b.kind}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter leaderboard" />
        </div>
        {rows.length ? <BoardList rows={rows} players={b.kind === "player"} /> : <div className="empty">No matches for that search.</div>}
      </div>
    </div>
  );
}
