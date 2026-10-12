"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TrophyIcon } from "@/components/ui/icons";

const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];

/** Deterministic confetti so server and client agree. */
function confetti() {
  let seed = 42;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 46 }, (_, i) => ({ left: `${(r() * 100).toFixed(1)}%`, background: COLORS[i % 5], animationDelay: `${(r() * 0.8).toFixed(2)}s`, transform: `rotate(${Math.floor(r() * 180)}deg)` }));
}

/** "You won!" popup for players on a winning team, shown once per tournament. */
export function WinnerPopup({ id, team, tournament, prize, message, href }: { id: string; team: string; tournament: string; prize: string | null; message: string; href: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLAnchorElement>(null);
  const key = `scheme:won:${id}`;

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(key) === "1";
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);
  }, [key]);

  useEffect(() => {
    if (!open) return;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function close() {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Private mode: the popup may show again, which is fine.
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal win-modal" role="dialog" aria-modal="true" aria-labelledby="win-title">
        <div className="confetti" aria-hidden="true">
          {confetti().map((s, i) => (
            <i key={i} style={s} />
          ))}
        </div>
        <div className="trophy">
          <TrophyIcon />
        </div>
        <p className="label">1st place</p>
        <h2 id="win-title">You won {tournament}!</h2>
        <p className="sub">{team} took first place. The win is on your profile and the leaderboards.</p>
        {prize ? (
          <div className="prizebox">
            <div>
              <div className="label" style={{ color: "var(--gold)" }}>
                Your prize
              </div>
              <div className="amt">{prize}</div>
              {message && <p>{message}</p>}
            </div>
          </div>
        ) : (
          <p className="small muted" style={{ marginTop: 14 }}>
            {message || "This event had no prize beyond the win itself."}
          </p>
        )}
        <div className="modal-actions">
          {prize && (
            <Link ref={button} href={href} className="btn gold" onClick={close}>
              See your prize
            </Link>
          )}
          <button type="button" className="btn" onClick={close}>
            {prize ? "Later" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
