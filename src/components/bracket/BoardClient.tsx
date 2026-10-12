"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { runOperation } from "@/app/t/[id]/actions";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";

/** What the hover card shows for one team. */
export interface HoverTeam {
  name: string;
  captain: string;
  avgRank: string;
  karma: number | null;
  wins: number;
  gameShort: string;
  stateLabel: string;
  stateTone: "good" | "warn" | "info";
  players: { handle: string; role: string; rank: string; verified: "api" | "self"; checkedIn: boolean }[];
}

/**
 * Interactive layer over a server-rendered bracket board:
 * - draws the connector wires between matches,
 * - shows a team's hover card on mouse over or keyboard focus,
 * - lets the host drag one first-round team onto another to swap them.
 */
export function BoardClient({
  children,
  teams,
  swap,
}: {
  children: React.ReactNode;
  teams: Record<string, HoverTeam>;
  /** Present when the host may drag teams: the tournament id and the tab to return to. */
  swap?: { tid: string; tab: string };
}) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, start] = useTransition();

  // Wires: from each match to the one its winner feeds, as in the prototype.
  const drawWires = useCallback(() => {
    root.current?.querySelectorAll<HTMLElement>(".bracket").forEach((br) => {
      const svg = br.querySelector("svg.wires");
      if (!svg) return;
      const box = br.getBoundingClientRect();
      svg.setAttribute("width", String(br.scrollWidth));
      svg.setAttribute("height", String(br.scrollHeight));
      let d = "";
      br.querySelectorAll<HTMLElement>(".match[data-feeds]").forEach((m) => {
        const tgt = br.querySelector<HTMLElement>(`.match[data-mid="${m.dataset.feeds}"]`);
        if (!tgt) return;
        const a = m.getBoundingClientRect();
        const b = tgt.getBoundingClientRect();
        const x1 = a.right - box.left;
        const y1 = a.top + a.height / 2 - box.top;
        const x2 = b.left - box.left;
        const y2 = b.top + b.height / 2 - box.top;
        const mx = (x1 + x2) / 2;
        d += `M${x1} ${y1}H${mx}V${y2}H${x2}`;
      });
      svg.innerHTML = `<path d="${d}"/>`;
    });
  }, []);

  useLayoutEffect(() => {
    drawWires();
    const ro = new ResizeObserver(drawWires);
    if (root.current) ro.observe(root.current);
    document.fonts?.ready.then(drawWires).catch(() => {});
    return () => ro.disconnect();
  }, [drawWires, children]);

  // Place the hover card next to the team, inside the viewport.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !hover) return;
    const r = hover.rect;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = r.right + 10;
    let y = r.top - 8;
    if (x + w > innerWidth - 12) x = Math.max(12, r.left - w - 10);
    if (y + h > innerHeight - 12) y = Math.max(12, innerHeight - h - 12);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [hover]);

  useEffect(() => {
    const hide = () => setHover(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, []);

  const teamEl = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest<HTMLElement>("[data-team]");
  const show = (e: React.SyntheticEvent) => {
    const el = teamEl(e);
    if (el && teams[el.dataset.team!] && drag === null) setHover({ id: el.dataset.team!, rect: el.getBoundingClientRect() });
  };
  const hide = (e: React.MouseEvent | React.FocusEvent) => {
    const el = teamEl(e);
    if (el && !el.contains(e.relatedTarget as Node | null)) setHover(null);
  };

  const slotOf = (e: React.DragEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]");
    return el && el.dataset.locked !== "true" ? Number(el.dataset.slot) : null;
  };

  const t = hover ? teams[hover.id] : null;
  return (
    <div
      ref={root}
      onMouseOver={show}
      onMouseOut={hide}
      onFocus={show}
      onBlur={hide}
      onDragStart={(e) => {
        if (!swap) return;
        const s = slotOf(e);
        if (s === null) return e.preventDefault();
        setHover(null);
        setDrag(s);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(s));
      }}
      onDragEnd={() => setDrag(null)}
      onDragOver={(e) => {
        if (drag === null) return;
        const s = slotOf(e);
        if (s !== null && s !== drag) {
          e.preventDefault();
          root.current?.querySelectorAll(".team.drop").forEach((x) => x.classList.remove("drop"));
          (e.target as HTMLElement).closest(".team")?.classList.add("drop");
        }
      }}
      onDragLeave={(e) => (e.target as HTMLElement).closest(".team")?.classList.remove("drop")}
      onDrop={(e) => {
        e.preventDefault();
        root.current?.querySelectorAll(".team.drop").forEach((x) => x.classList.remove("drop"));
        const to = slotOf(e);
        const from = drag;
        setDrag(null);
        if (!swap || from === null || to === null || from === to) return;
        const fd = new FormData();
        fd.set("tournamentId", swap.tid);
        fd.set("op", "swap");
        fd.set("tab", swap.tab);
        fd.set("a", String(from));
        fd.set("b", String(to));
        start(() => runOperation(fd));
      }}
      aria-busy={pending}
      style={pending ? { opacity: 0.6, transition: "opacity .15s" } : undefined}
      data-dragging={drag !== null || undefined}
    >
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
