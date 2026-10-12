"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import type { HoverTeam } from "./hover";

/**
 * Shows a team's hover card when the pointer is over, or keyboard focus is
 * on, any element inside with a `data-team` attribute.
 */
export function HoverLayer({ teams, paused = false, children }: { teams: Record<string, HoverTeam>; paused?: boolean; children: React.ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !hover) return;
    const r = hover.rect;
    let x = r.right + 10;
    let y = r.top - 8;
    if (x + el.offsetWidth > innerWidth - 12) x = Math.max(12, r.left - el.offsetWidth - 10);
    if (y + el.offsetHeight > innerHeight - 12) y = Math.max(12, innerHeight - el.offsetHeight - 12);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [hover]);

  useEffect(() => {
    const hide = () => setHover(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, []);
  useEffect(() => {
    if (paused) setHover(null);
  }, [paused]);

  const teamEl = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest<HTMLElement>("[data-team]");
  const show = (e: React.SyntheticEvent) => {
    const el = teamEl(e);
    if (!paused && el && teams[el.dataset.team!]) setHover({ id: el.dataset.team!, rect: el.getBoundingClientRect() });
  };
  const hide = (e: React.MouseEvent | React.FocusEvent) => {
    const el = teamEl(e);
    if (el && !el.contains(e.relatedTarget as Node | null)) setHover(null);
  };

  const t = hover ? teams[hover.id] : null;
  return (
    <div onMouseOver={show} onMouseOut={hide} onFocus={show} onBlur={hide}>
      {children}
      {t && (
        <div ref={card} className="hovercard" role="tooltip" style={{ left: -9999, top: -9999 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h4>{t.name}</h4>
            <span className={`pill ${t.stateTone}`}>{t.stateLabel}</span>
          </div>
          <div className="hc-stats">
            <div>
              <b>{t.avgRank}</b>
              <span>avg rank</span>
            </div>
            <div>
              <b>{t.karma ?? "—"}</b>
              <span>karma</span>
            </div>
            <div>
              <b>{t.wins}</b>
              <span>{t.gameShort} wins</span>
            </div>
          </div>
          <ul className="roster">
            {t.players.map((p) => (
              <li key={p.handle}>
                <span>
                  {p.handle}
                  {p.handle === t.captain && <span className="tiny muted"> (c)</span>}
                </span>
                <span className="tiny muted">{p.role}</span>
                <span className="mono tiny">
                  {p.rank}{" "}
                  <span className={`vmark ${p.verified === "self" ? "self" : ""}`} title={p.verified === "self" ? "Self-reported rank" : "Verified rank"}>
                    {p.verified === "self" ? <WarnIcon /> : <CheckIcon />}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
