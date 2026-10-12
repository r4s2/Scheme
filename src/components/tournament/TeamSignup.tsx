"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { GAMES, roleCounts, type GameId } from "@/engine";
import type { PlayerHit } from "@/app/players/actions";
import { runOp, type OpResult } from "@/app/t/[id]/actions";
import { PlayerPicker } from "@/components/PlayerPicker";
import { withNotice } from "@/components/Toaster";
import { LockIcon } from "@/components/ui/icons";
import type { EligibilityRules } from "@/server/registration";

/** Runs the action and shows its result as a notice. */
const run = withNotice(runOp);

export interface RosterOption {
  id: string;
  name: string;
  members: { handle: string; role: string | null; rank: string; blocker: string | null; note: string | null }[];
}

interface Spot {
  handle: string;
  role: string;
}

/** What the form knows about a player once they're picked: rank, and anything that stops or flags them. */
interface Info {
  rank: string | null;
  blocker: string | null;
  note: string | null;
}

export type { Info as PlayerInfo };

export interface RosterEdit {
  teamId: string;
  name: string;
  players: Spot[];
  bench: Spot[];
  /** Answers so far, by handle; absent means confirmed. */
  answers: Record<string, "pending" | "declined">;
}

/**
 * A captain's roster: the starting lineup plus optional subs. Every player
 * box searches Scheme players. In games with a fixed composition (League's
 * positions, Overwatch role queue) starting roles are locked; elsewhere each
 * player's role is a dropdown, and subs can be listed as any role.
 *
 * Used to register a team, and (with `edit`) to change it while registration is open.
 */
export function TeamSignup({
  tid,
  game,
  roles,
  benchMax,
  rules,
  taken,
  rosters,
  actor,
  edit,
  onDone,
  known: seeded = {},
}: {
  tid: string;
  game: GameId;
  /** The event's lineup: one role per starting seat. */
  roles: string[];
  benchMax: number;
  rules: EligibilityRules;
  /** Everyone already in the event on another team. */
  taken: string[];
  rosters: RosterOption[];
  actor: string;
  edit?: RosterEdit;
  onDone?: () => void;
  /** What's already known about players, e.g. the ranks they registered with. */
  known?: Record<string, Info>;
}) {
  const G = GAMES[game];
  const blank = (): Spot[] => roles.map((role, i) => ({ handle: i === 0 ? actor : "", role }));
  const [name, setName] = useState(edit?.name ?? "");
  const [starters, setStarters] = useState<Spot[]>(edit?.players ?? blank);
  const [bench, setBench] = useState<Spot[]>(edit?.bench ?? []);
  const [info, setInfo] = useState<Record<string, Info>>(() => Object.fromEntries(Object.entries(seeded).map(([h, i]) => [h.toLowerCase(), i])));
  const [picked, setPicked] = useState("");
  const [result, action, pending] = useActionState<OpResult | null, FormData>(run, null);

  useEffect(() => {
    if (result?.ok) onDone?.();
    // Only when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const known = (h: string) => info[h.toLowerCase()];
  const learn = (entries: [string, Info][]) => setInfo((x) => ({ ...x, ...Object.fromEntries(entries.map(([h, i]) => [h.toLowerCase(), i])) }));
  const fromHit = (h: PlayerHit): Info => ({ rank: h.rank, blocker: h.blocker, note: h.note });
  const takenSet = new Set(taken.map((h) => h.toLowerCase()));
  const listed = [...starters, ...bench].map((s) => s.handle).filter(Boolean);

  const fill = (id: string) => {
    setPicked(id);
    const r = rosters.find((x) => x.id === id);
    if (!r) {
      setStarters(blank());
      setBench([]);
      return;
    }
    setName(r.name);
    learn(r.members.map((m) => [m.handle, { rank: m.rank, blocker: m.blocker, note: m.note }]));
    // Put the captain first, then seat each member in their usual role where it fits.
    const left = [...r.members].sort((a, b) => Number(b.handle === actor) - Number(a.handle === actor));
    const next: Spot[] = roles.map((role) => {
      const i = left.findIndex((m) => m.role === role);
      return { role, handle: i >= 0 ? left.splice(i, 1)[0].handle : "" };
    });
    for (const s of next) {
      if (s.handle || !left.length) continue;
      const m = left.shift()!;
      s.handle = m.handle;
      if (!G.lockedRoles && m.role && G.roleOptions.includes(m.role)) s.role = m.role;
    }
    setStarters(next);
    // Anyone left over starts as a sub, as far as the event allows.
    setBench(left.slice(0, benchMax).map((m) => ({ handle: m.handle, role: m.role && G.roleOptions.includes(m.role) ? m.role : G.subRole })));
  };

  const setSpot = (list: "s" | "b", i: number, patch: Partial<Spot>) => {
    const upd = (xs: Spot[]) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x));
    if (list === "s") setStarters(upd);
    else setBench(upd);
  };

  const status = (h: string) => {
    if (!h) return <span className="muted">—</span>;
    const lower = h.toLowerCase();
    if (takenSet.has(lower)) return <span className="picker-bad">Already in this event</span>;
    if (listed.filter((x) => x.toLowerCase() === lower).length > 1) return <span className="picker-bad">Listed twice</span>;
    const i = known(h);
    const onBefore = !!edit?.players.concat(edit.bench).some((s) => s.handle === h);
    const given: string | undefined = edit?.answers[h];
    const answer: string | undefined = edit ? (h === actor ? "captain" : (given ?? (onBefore ? "confirmed" : "new"))) : undefined;
    const conf =
      answer === "pending" ? (
        <span className="pill warn">Waiting to confirm</span>
      ) : answer === "declined" ? (
        <span className="pill bad">Can&apos;t play</span>
      ) : answer === "new" ? (
        <span className="pill quiet">Will be asked to confirm</span>
      ) : answer === "confirmed" ? (
        <span className="pill good">Confirmed</span>
      ) : null;
    if (!i) return conf ?? <span className="muted">Checked when you submit</span>;
    return (
      <span className="row" style={{ gap: 6 }}>
        {i.blocker ? <span className="picker-bad">{i.blocker}</span> : <span className="role-ok">{i.rank ?? "No rank"} ✓</span>}
        {!i.blocker && i.note && <span className="picker-warn">{i.note}</span>}
        {conf}
      </span>
    );
  };

  const row = (list: "s" | "b", s: Spot, i: number) => {
    const locked = list === "s" && G.lockedRoles;
    const label = list === "s" ? `Starter ${i + 1}` : `Sub ${i + 1}`;
    return (
      <tr key={`${list}${i}`}>
        <td>
          {locked ? (
            <span className="role-lock" title={`${G.name} lineups are one player per position`}>
              <LockIcon /> {s.role}
            </span>
          ) : (
            <select value={s.role} onChange={(e) => setSpot(list, i, { role: e.target.value })} aria-label={`${label} role`}>
              {G.roleOptions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          )}
        </td>
        <td>
          <PlayerPicker
            value={s.handle}
            onChange={(h) => setSpot(list, i, { handle: h })}
            onPick={(h) => learn([[h.handle, fromHit(h)]])}
            game={game}
            rules={rules}
            exclude={listed.filter((x) => x.toLowerCase() !== s.handle.toLowerCase())}
            placeholder="Search Scheme players"
            ariaLabel={`${label} (${s.role}) player`}
            style={{ width: "100%" }}
          />
          {s.handle === actor && <span className="tiny muted"> You (captain)</span>}
        </td>
        <td className="small">{status(s.handle)}</td>
        <td>
          {list === "b" && (
            <button type="button" className="btn xs ghost" onClick={() => setBench(bench.filter((_, j) => j !== i))} aria-label={`Remove sub ${i + 1}`}>
              Remove
            </button>
          )}
        </td>
      </tr>
    );
  };

  const ready = name.trim().length >= 2 && starters.every((s) => s.handle) && bench.every((s) => s.handle);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="tournamentId" value={tid} />
      <input type="hidden" name="op" value={edit ? "updateRoster" : "registerTeam"} />
      {edit && <input type="hidden" name="teamId" value={edit.teamId} />}
      <input type="hidden" name="players" value={JSON.stringify(starters)} />
      <input type="hidden" name="bench" value={JSON.stringify(bench)} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{edit ? "Edit your roster" : "Register your team"}</h3>
        {!edit &&
          (rosters.length > 0 ? (
            <select value={picked} onChange={(e) => fill(e.target.value)} aria-label="Fill from a saved team">
              <option value="">Fill from a saved team…</option>
              {rosters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="small muted">
              Tip: <Link href="/teams">save your team</Link> to register in one step next time.
            </span>
          ))}
      </div>
      <label className="field">
        <span>Team name</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
      </label>

      <div>
        <div className="roster-h">
          <b>Starting lineup</b>
          <span className="small muted">
            {G.lockedRoles
              ? `${G.name} lineups are ${Object.entries(roleCounts(roles)).map(([r, n]) => `${n} ${r}`).join(", ")}. Choose who plays each spot.`
              : `${G.name} has no fixed composition: pick each player's main role.`}
          </span>
        </div>
        <div className="tblwrap">
          <table className="tbl roster-tbl">
            <thead>
              <tr>
                <th>Role</th>
                <th>Player</th>
                <th>Status</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>{starters.map((s, i) => row("s", s, i))}</tbody>
          </table>
        </div>
      </div>

      {benchMax > 0 ? (
        <div>
          <div className="roster-h">
            <b>Subs</b>
            <span className="small muted">
              Optional, up to {benchMax}. A sub&apos;s role is their usual one; they can still fill in anywhere.
            </span>
          </div>
          {bench.length > 0 && (
            <div className="tblwrap">
              <table className="tbl roster-tbl">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Player</th>
                    <th>Status</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>{bench.map((s, i) => row("b", s, i))}</tbody>
              </table>
            </div>
          )}
          <button type="button" className="btn sm" disabled={bench.length >= benchMax} onClick={() => setBench([...bench, { handle: "", role: G.subRole }])} style={{ marginTop: 8 }}>
            + Add a sub{bench.length ? ` (${bench.length} of ${benchMax})` : ""}
          </button>
        </div>
      ) : (
        <p className="small muted">This event doesn&apos;t take subs.</p>
      )}

      <p className="small muted">Everyone you list gets a notification to confirm they&apos;re playing.</p>
      <div className="row">
        <button className="btn primary" disabled={pending || !ready}>
          {pending ? (edit ? "Saving…" : "Registering…") : edit ? "Save roster" : "Register team"}
        </button>
        {edit && onDone && (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
