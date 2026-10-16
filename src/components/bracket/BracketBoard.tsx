"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  averageScore,
  buildBracket,
  canReopen,
  canTransform,
  deadlineFor,
  FORMAT_NAMES,
  lockedSlots,
  matchStatus,
  randomizeSlots,
  rankShortName,
  recordResult,
  reopenResult,
  resultOf,
  scoreOptions,
  seedSlots,
  swapSlots,
  type FormatId,
  type GameId,
  type Match,
  type MatchStatus,
  type Schedule,
  type TournamentState,
} from "@/engine";
import { runOp, type OpResult } from "@/app/t/[id]/actions";
import { toast } from "@/components/Toaster";
import { SeedIcon, ShuffleIcon, TransformIcon } from "@/components/ui/icons";
import { formatWhen, statusText } from "@/lib/format";
import { hoverTeams, type Phase } from "./hover";
import { HoverLayer } from "./HoverLayer";

const FORMATS = Object.keys(FORMAT_NAMES) as FormatId[];
const ST_CLASS: Partial<Record<MatchStatus["kind"], string>> = { final: "done", forfeit: "done", overdue: "over", due: "due", disputed: "over", awaiting_confirm: "due" };

export interface BracketBoardProps {
  state: TournamentState;
  game: GameId;
  /** Present for a stored tournament: its id and the version this state came from. */
  tid?: string;
  version?: number;
  /** For match status: the server's clock, the schedule, and what's pending. */
  now?: string;
  schedule?: Schedule;
  live?: boolean;
  pendingReports?: string[];
  openDisputes?: string[];
  mine?: string | null;
  wins?: Record<string, number>;
  phase?: Phase;
  /** Host controls: move teams (drag, click, randomize, seed, transform) and enter results on the board. */
  host?: { arrange: boolean; results: boolean };
}

type View = { state: TournamentState; version: number };
type Rects = Map<string, DOMRect>;

/**
 * The bracket board. Everything happens in place, like moving pieces on a
 * board: the host drags (or clicks) a team onto another, randomizes, seeds or
 * changes the format, and teams glide to their new spots straight away. The
 * change saves in the background with an Undo; if the save is refused, the
 * board slides back to what's stored. Results entered on a match advance the
 * winner the same way.
 */
export function BracketBoard(props: BracketBoardProps) {
  const { game, tid, host, mine, wins = {}, phase = "play" } = props;
  const [view, setView] = useState<View>({ state: props.state, version: props.version ?? 0 });
  const confirmed = useRef<View>({ state: props.state, version: props.version ?? 0 });
  const queue = useRef<{ fields: Record<string, string>; undo?: () => void }[]>([]);
  const running = useRef(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<Rects | null>(null);
  const state = view.state;

  // New data from the server (someone else's change, or the page refreshing) replaces ours when it's newer.
  useEffect(() => {
    if (queue.current.length || (props.version ?? 0) <= confirmed.current.version) return;
    confirmed.current = { state: props.state, version: props.version ?? 0 };
    setView(confirmed.current);
    setSyncing(false);
  }, [props.version, props.state]);
  // A reload that brings nothing newer still ends the wait.
  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(() => setSyncing(false), 4000);
    return () => clearTimeout(t);
  }, [syncing]);

  const bracket = useMemo(() => buildBracket(state), [state]);
  const locked = useMemo(() => (host?.arrange ? lockedSlots(state, state.slots, state.format) : new Set<number>()), [host?.arrange, state]);
  const hover = useMemo(() => hoverTeams(state, game, wins, phase), [state, game, wins, phase]);
  const now = useMemo(() => (props.now ? new Date(props.now) : null), [props.now]);
  const name = (id: string | null) => (id ? (state.teams[id]?.name ?? id) : null);

  // ---------------------------------------------------------------------------
  // Animation: remember where every team was, then slide each from there to its new spot.

  const capture = useCallback((override?: [string, DOMRect]): Rects => {
    const m: Rects = new Map();
    root.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => m.set(el.dataset.flip!, el.getBoundingClientRect()));
    if (override) m.set(override[0], override[1]);
    return m;
  }, []);

  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from || !root.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.current.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r0 = from.get(el.dataset.flip!);
      if (!r0) {
        el.animate([{ opacity: 0, transform: "scale(0.94)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
        return;
      }
      const r1 = el.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 5, boxShadow: "var(--shadow)" },
          { transform: "none", zIndex: 5, boxShadow: "none" },
        ],
        { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    });
  }, [view]);

  // Wires between matches, as in the prototype. Redrawn whenever the board renders or changes size
  // (including when its tab is shown again).
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
        d += `M${x1} ${y1}H${(x1 + x2) / 2}V${y2}H${x2}`;
      });
      svg.innerHTML = `<path d="${d}"/>`;
    });
  }, []);
  useLayoutEffect(drawWires);
  useEffect(() => {
    if (!root.current) return;
    const ro = new ResizeObserver(drawWires);
    ro.observe(root.current);
    document.fonts?.ready.then(drawWires).catch(() => {});
    return () => ro.disconnect();
  }, [drawWires]);

  // ---------------------------------------------------------------------------
  // Saving: show the change now, save it, and settle on what the server stored.

  // Moves never wait for each other: each one shows straight away and joins a queue that saves in
  // order, each save building on the version the previous one stored. If a save is refused, the rest
  // of the queue is dropped and the board slides back to what's stored.

  const drain = useCallback(async () => {
    if (running.current || !tid) return;
    running.current = true;
    while (queue.current.length) {
      const job = queue.current[0];
      const fd = new FormData();
      fd.set("tournamentId", tid);
      fd.set("version", String(confirmed.current.version));
      for (const [k, v] of Object.entries(job.fields)) fd.set(k, v);
      let res: OpResult | null;
      try {
        res = await runOp(null, fd);
      } catch {
        res = null;
      }
      queue.current.shift();
      if (res?.ok && res.state) {
        confirmed.current = { state: res.state, version: res.version ?? confirmed.current.version + 1 };
        // Only settle on the server's copy once nothing newer is waiting to save.
        if (!queue.current.length) setView(confirmed.current);
        toast({ message: res.message, undo: job.undo });
      } else {
        queue.current = [];
        flipFrom.current = capture();
        if (res?.state) {
          confirmed.current = { state: res.state, version: res.version ?? confirmed.current.version };
          setView(confirmed.current);
          toast({ message: res.message, tone: "err" });
        } else {
          // No answer at all: the board can't know what's stored, so it waits for the page to reload its data.
          setView(confirmed.current);
          setSyncing(true);
          toast({ message: "Couldn't save that. Check your connection; the board is reloading.", tone: "err" });
          router.refresh();
        }
      }
      setPending(queue.current.length);
    }
    running.current = false;
  }, [tid, capture, router]);

  const save = useCallback(
    (next: TournamentState, fields: Record<string, string>, opts: { flip?: Rects; undo?: () => void } = {}) => {
      if (!tid || syncing) return;
      flipFrom.current = opts.flip ?? capture();
      setView((v) => ({ state: next, version: v.version }));
      queue.current.push({ fields, undo: opts.undo });
      setPending(queue.current.length);
      void drain();
    },
    [tid, syncing, capture, drain],
  );

  const arrange = useCallback(
    (slots: string[], format: FormatId, kind: string, flip?: Rects) => {
      const prev = { slots: state.slots, format: state.format };
      void save(
        { ...state, slots, format },
        { op: "arrange", kind, slots: JSON.stringify(slots), format },
        {
          flip,
          // Undo puts the previous arrangement back (the server checks it's still allowed).
          undo: () => arrangeRef.current?.(prev.slots, prev.format, "undo"),
        },
      );
    },
    [state, save],
  );
  const arrangeRef = useRef(arrange);
  useEffect(() => {
    arrangeRef.current = arrange;
  }, [arrange]);

  const swap = (a: number, b: number, flip?: Rects) => {
    setSelected(null);
    if (a === b) return;
    const r = swapSlots(state, a, b);
    if (!r.ok) return toast({ message: r.reason, tone: "err" });
    arrange(r.slots, state.format, "swap", flip);
  };

  // ---------------------------------------------------------------------------
  // Moving teams with the pointer: pick a team up, carry it, drop it on another.

  const drag = useRef<{ from: number; el: HTMLElement; x: number; y: number; ghost?: HTMLElement; over?: HTMLElement | null; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const slotTarget = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot]");
    return el && root.current?.contains(el) && el.dataset.locked !== "true" ? el : null;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        d.moved = true;
        setDragging(true);
        const r = d.el.getBoundingClientRect();
        const g = d.el.cloneNode(true) as HTMLElement;
        g.classList.add("ghost");
        Object.assign(g.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, pointerEvents: "none", zIndex: "90" });
        g.dataset.dx = String(d.x - r.left);
        g.dataset.dy = String(d.y - r.top);
        g.removeAttribute("data-flip");
        document.body.appendChild(g);
        d.ghost = g;
        d.el.classList.add("dragging");
      }
      const g = d.ghost!;
      g.style.left = `${e.clientX - Number(g.dataset.dx)}px`;
      g.style.top = `${e.clientY - Number(g.dataset.dy)}px`;
      const over = slotTarget(e.clientX, e.clientY);
      if (over !== d.over) {
        d.over?.classList.remove("drop");
        if (over && over !== d.el) over.classList.add("drop");
        d.over = over;
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      d.el.classList.remove("dragging");
      d.over?.classList.remove("drop");
      if (!d.moved) return;
      setDragging(false);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const ghostRect = d.ghost!.getBoundingClientRect();
      d.ghost!.remove();
      const to = slotTarget(e.clientX, e.clientY);
      if (to && to !== d.el) {
        // The dragged team glides from where it was dropped; the other one slides into its old place.
        swap(d.from, Number(to.dataset.slot), capture([d.el.dataset.flip!, ghostRect]));
      } else if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const r = d.el.getBoundingClientRect();
        d.el.animate([{ transform: `translate(${ghostRect.left - r.left}px, ${ghostRect.top - r.top}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      const d = drag.current;
      if (d?.ghost) {
        d.ghost.remove();
        d.el.classList.remove("dragging");
        d.over?.classList.remove("drop");
        setDragging(false);
      }
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
  });

  const canMove = (slot: number | undefined) => !!host?.arrange && !syncing && slot !== undefined && !locked.has(slot);

  const pick = (slot: number) => {
    if (suppressClick.current) return;
    if (selected === null) return setSelected(slot);
    if (selected === slot) return setSelected(null);
    swap(selected, slot);
  };

  // ---------------------------------------------------------------------------
  // Rendering

  const flipKeys = new Set<string>();
  const teamChip = (id: string | null, slot: number | undefined, placeholder: string | undefined, where: string) => {
    if (!id) return <span className="team tbd">{placeholder ?? "TBD"}</span>;
    const movable = canMove(slot);
    // First appearance of a team is "the piece"; later rounds fade in when a team advances.
    const key = flipKeys.has(id) ? `${id}@${where}` : id;
    flipKeys.add(id);
    return (
      <span
        className={`team ${id === mine ? "is-mine" : ""} ${state.teams[id]?.rejected ? "rejected" : ""} ${movable ? "movable" : "static"} ${selected !== null && selected === slot ? "selected" : ""}`}
        data-team={id}
        data-flip={key}
        data-slot={slot}
        data-locked={slot !== undefined && locked.has(slot) ? "true" : undefined}
        tabIndex={0}
        role={movable ? "button" : undefined}
        aria-pressed={movable ? selected === slot : undefined}
        aria-label={movable ? `${name(id)}. ${selected === null ? "Press to pick up, then pick another team to swap." : selected === slot ? "Picked up. Pick another team to swap, or press again to put it down." : `Swap with ${name(state.slots[selected])}.`}` : undefined}
        title={state.teams[id]?.rejected ? `Rejected: ${state.teams[id].rejected}` : slot !== undefined && locked.has(slot) && host?.arrange ? "Locked: this team has a confirmed result" : undefined}
        onPointerDown={
          movable
            ? (e) => {
                if (e.button !== 0) return;
                drag.current = { from: slot!, el: e.currentTarget, x: e.clientX, y: e.clientY, moved: false };
              }
            : undefined
        }
        onClick={movable ? () => pick(slot!) : undefined}
        onKeyDown={
          movable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(slot!);
                }
              }
            : undefined
        }
      >
        <span className="tn">{name(id)}</span>
        <span className="tr">{rankShortName(game, averageScore(state.teams[id]))}</span>
      </span>
    );
  };

  const status = (m: Match): MatchStatus | null =>
    now && props.schedule
      ? matchStatus(state, m, {
          now,
          schedule: props.schedule,
          live: !!props.live && props.schedule.waveDeadlines.length > 0,
          hasPendingReport: !!props.pendingReports?.includes(m.id),
          hasOpenDispute: !!props.openDisputes?.includes(m.id),
        })
      : null;

  const matchCard = (m: Match) => {
    const r = resultOf(state, m);
    const st = status(m);
    const cls = r ? "done" : st ? (ST_CLASS[st.kind] ?? "") : "";
    const text = r ? (r.by === "forfeit" ? "Forfeit" : "Final") : st ? statusText(st) : m.a && m.b ? "Open" : "Waiting";
    const due = !r && m.a && m.b && props.schedule && props.live ? deadlineFor(props.schedule, m) : null;
    const row = (id: string | null, slot: number | undefined, placeholder: string | undefined, side: string) => {
      const won = !!r && r.winner === id;
      const score = r ? (r.by === "forfeit" ? (won ? "W" : "FF") : won ? r.w : r.l) : "";
      return (
        <div className={`slot ${won ? "win" : r ? "lose" : ""}`}>
          {teamChip(id, slot, placeholder, `${m.id}${side}`)}
          <span className="score">{score}</span>
        </div>
      );
    };
    const isMine = !!mine && (m.a === mine || m.b === mine);
    const results = !!host?.results && !!tid;
    return (
      <div key={m.id} className={`match ${cls === "over" ? "over" : ""} ${isMine ? "mine" : ""}`} data-mid={m.id} data-feeds={m.feeds}>
        <div className="match-head">
          <span>
            {m.id} · Bo{state.bestOf}
          </span>
          <span className={`st ${cls}`} title={due ? `Deadline ${formatWhen(due)}` : undefined}>
            {text}
          </span>
        </div>
        {row(m.a, m.sa, m.pa, "a")}
        {row(m.b, m.sb, m.pb, "b")}
        {results && entering === m.id && m.a && m.b ? (
          <ResultForm
            match={m}
            names={[name(m.a)!, name(m.b)!]}
            bestOf={state.bestOf}
            onCancel={() => setEntering(null)}
            onSave={(winner, w, l, forfeit) => {
              setEntering(null);
              let next: TournamentState;
              try {
                next = recordResult(state, m.id, winner, w, l, forfeit ? "forfeit" : "host").state;
              } catch (e) {
                return toast({ message: (e as Error).message, tone: "err" });
              }
              void save(next, { op: "recordResult", matchId: m.id, winner, score: `${w}-${l}`, ...(forfeit ? { forfeit: "on" } : {}) });
            }}
          />
        ) : (
          results &&
          m.a &&
          m.b &&
          (!r || canReopen(state, bracket, m)) && (
            <div className="match-foot">
              {!r ? (
                <button type="button" className="btn xs" disabled={syncing} onClick={() => setEntering(m.id)}>
                  Enter result
                </button>
              ) : (
                <button
                  type="button"
                  className="btn xs ghost"
                  disabled={syncing}
                  onClick={() => void save(reopenResult(state, m.id), { op: "reopen", matchId: m.id })}
                  title="Clear this result so it can be entered again"
                >
                  Reopen
                </button>
              )}
            </div>
          )
        )}
      </div>
    );
  };

  const crossTable = (teamIds: string[], slotIndexes?: number[]) => (
    <div className="tblwrap">
      <table className="xt">
        <thead>
          <tr>
            <th>Team</th>
            {teamIds.map((id) => (
              <th key={id} title={name(id) ?? id}>
                {(name(id) ?? id).slice(0, 3).toUpperCase()}
              </th>
            ))}
            <th>W–L</th>
          </tr>
        </thead>
        <tbody>
          {teamIds.map((rowId, ri) => {
            let w = 0;
            let l = 0;
            const cells = teamIds.map((col) => {
              if (rowId === col)
                return (
                  <td key={col} className="self">
                    —
                  </td>
                );
              const m = bracket.matches.find((x) => (x.a === rowId && x.b === col) || (x.a === col && x.b === rowId));
              const r = resultOf(state, m);
              if (r) {
                if (r.winner === rowId) w++;
                else l++;
              }
              return (
                <td key={col}>
                  {r ? (
                    r.winner === rowId ? (
                      <span className="w">W {r.by === "forfeit" ? "FF" : `${r.w}–${r.l}`}</span>
                    ) : (
                      <span className="l">L {r.by === "forfeit" ? "FF" : `${r.l}–${r.w}`}</span>
                    )
                  ) : (
                    <span className="muted">·</span>
                  )}
                </td>
              );
            });
            return (
              <tr key={rowId}>
                <td className="tcell">{teamChip(rowId, slotIndexes?.[ri], undefined, `x${ri}`)}</td>
                {cells}
                <td className="rec">
                  {w}–{l}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const tf = canTransform(state);
  return (
    <>
      {host?.arrange && tid && (
        <Toolbar
          busy={syncing}
          saving={pending > 0}
          format={state.format}
          canTransform={tf}
          lockedCount={locked.size}
          picking={selected !== null ? name(state.slots[selected]) : null}
          onRandomize={() => {
            const slots = randomizeSlots(state, state.slots, state.format, Date.now());
            if (slots.every((s, i) => s === state.slots[i])) return toast({ message: "Every team is locked by a result, so there's nothing to shuffle.", tone: "err" });
            arrange(slots, state.format, "randomize");
          }}
          onSeed={() => {
            const slots = seedSlots(state, state.slots, state.format);
            if (slots.every((s, i) => s === state.slots[i])) return toast({ message: "Already seeded by rank. Nothing to change." });
            arrange(slots, state.format, "seed");
          }}
          onTransform={(f) => arrange(state.slots, f, "transform")}
        />
      )}
      <HoverLayer teams={hover} paused={dragging}>
        <div ref={root} className={`board ${syncing ? "syncing" : ""} ${dragging ? "is-dragging" : ""}`} aria-busy={pending > 0 || syncing}>
          {syncing && (
            <div className="board-wait" role="status">
              <span className="spinner" aria-hidden="true" />
              <span className="sr-only">Reloading the bracket</span>
            </div>
          )}
          {bracket.parts.map((part, i) => {
            if (part.kind === "bracket" || part.kind === "swiss") {
              const flat = part.kind === "swiss";
              return (
                <div key={`${state.format}-${i}`} className="bsec">
                  {part.title && <h3 className="bsec-title">{part.title}</h3>}
                  <div className={`bracket ${flat ? "flat" : ""}`}>
                    {!flat && <svg className="wires" aria-hidden="true" />}
                    {part.columns.map((c) => (
                      <div key={c.title} className="bcol">
                        <div className="bcol-title">{c.title}</div>
                        <div className="bcol-body">
                          {c.matches.map(matchCard)}
                          {c.note && <div className="note-card">{c.note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            if (part.kind === "cross") {
              return (
                <div key={`${state.format}-${i}`} className="bsec">
                  <h3 className="bsec-title">{part.title}</h3>
                  {crossTable(part.teamIds)}
                </div>
              );
            }
            if (part.kind === "groups") {
              return (
                <div key={`${state.format}-${i}`} className="bsec">
                  <h3 className="bsec-title">{part.title}</h3>
                  <div className="groups">
                    {part.groups.map((g) => (
                      <div key={g.name} className="group">
                        <h4>{g.name}</h4>
                        {crossTable(g.teamIds, g.slotIndexes)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div key={`${state.format}-${i}`} className="bsec">
                <h3 className="bsec-title">{part.title}</h3>
                <ol className="lb card" style={{ padding: "4px 14px", maxWidth: 420 }}>
                  {bracket.standings.map((s, j) => (
                    <li key={s.teamId}>
                      <span className="pos">{j + 1}</span>
                      <span className="who">{teamChip(s.teamId, undefined, undefined, `s${j}`)}</span>
                      <span className="wins">
                        {s.wins}–{s.losses}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </HoverLayer>
    </>
  );
}

function Toolbar({
  busy,
  saving,
  format,
  canTransform: tf,
  lockedCount,
  picking,
  onRandomize,
  onSeed,
  onTransform,
}: {
  busy: boolean;
  saving: boolean;
  format: FormatId;
  canTransform: boolean;
  lockedCount: number;
  picking: string | null;
  onRandomize: () => void;
  onSeed: () => void;
  onTransform: (f: FormatId) => void;
}) {
  const [target, setTarget] = useState<FormatId>(FORMATS.find((f) => f !== format)!);
  useEffect(() => {
    if (target === format) setTarget(FORMATS.find((f) => f !== format)!);
  }, [format, target]);
  return (
    <div className="toolbar">
      <button type="button" className="btn sm" disabled={busy} onClick={onRandomize} title="Shuffle every team not locked by a result">
        <ShuffleIcon />
        Randomize
      </button>
      <button type="button" className="btn sm" disabled={busy} onClick={onSeed} title="Seed by average verified rank: strongest meets weakest, top seeds meet late">
        <SeedIcon />
        Auto-seed by rank
      </button>
      <span className="row" style={{ gap: 6 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value as FormatId)} disabled={!tf || busy} aria-label="New format" style={{ padding: "5px 8px", fontSize: 13 }}>
          {FORMATS.filter((f) => f !== format).map((f) => (
            <option key={f} value={f}>
              {FORMAT_NAMES[f]}
            </option>
          ))}
        </select>
        <button type="button" className="btn sm" disabled={!tf || busy} onClick={() => onTransform(target)} title={tf ? "Change the format, keeping first-round results" : "Locked once results go past round one"}>
          <TransformIcon />
          Transform
        </button>
      </span>
      <span className="hint" aria-live="polite">
        {busy
          ? "Reloading the bracket…"
          : saving
          ? "Saving…"
          : picking
            ? `Picked up ${picking}. Pick another team to swap, or press Esc.`
            : `Drag a team onto another to swap them, or click one then the other.${lockedCount ? ` ${lockedCount} locked by results.` : ""}`}
      </span>
    </div>
  );
}

function ResultForm({
  match,
  names,
  bestOf,
  onSave,
  onCancel,
}: {
  match: Match;
  names: [string, string];
  bestOf: number;
  onSave: (winner: string, w: number, l: number, forfeit: boolean) => void;
  onCancel: () => void;
}) {
  const [winner, setWinner] = useState<string>(match.a!);
  const opts = scoreOptions(bestOf);
  const [score, setScore] = useState(`${opts[0][0]}-${opts[0][1]}`);
  const [forfeit, setForfeit] = useState(false);
  return (
    <form
      className="match-foot result-form"
      onSubmit={(e) => {
        e.preventDefault();
        const [w, l] = score.split("-").map(Number);
        onSave(winner, w, l, forfeit);
      }}
    >
      <div className="seg" role="radiogroup" aria-label="Winner">
        {[match.a!, match.b!].map((id, i) => (
          <button key={id} type="button" role="radio" aria-checked={winner === id} onClick={() => setWinner(id)}>
            {names[i]}
          </button>
        ))}
      </div>
      <select value={score} onChange={(e) => setScore(e.target.value)} disabled={forfeit} aria-label="Score" style={{ padding: "3px 6px", fontSize: 12.5 }}>
        {opts.map(([w, l]) => (
          <option key={`${w}-${l}`} value={`${w}-${l}`}>
            {w}–{l}
          </option>
        ))}
      </select>
      <label className="tiny" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} /> Forfeit
      </label>
      <button type="button" className="btn xs ghost" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn xs primary">Save</button>
    </form>
  );
}
