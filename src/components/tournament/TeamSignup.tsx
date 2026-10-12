"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { runOp, type OpResult } from "@/app/t/[id]/actions";
import { withNotice } from "@/components/Toaster";

/** Runs the action and shows its result as a notice. */
const run = withNotice(runOp);

export interface RosterOption {
  id: string;
  name: string;
  members: { handle: string; role: string | null; rank: string; blocker: string | null }[];
}

/**
 * A captain registers a team: pick a saved team to fill the seats, adjust
 * who plays which role, and submit. Scheme checks every player's linked
 * account when the form is sent.
 */
export function TeamSignup({ tid, roles, rosters, actor }: { tid: string; roles: string[]; rosters: RosterOption[]; actor: string }) {
  const empty = () => roles.map((role, i) => ({ handle: i === 0 ? actor : "", role }));
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(empty);
  const [picked, setPicked] = useState<string>("");
  const [, action, pending] = useActionState<OpResult | null, FormData>(run, null);

  const fill = (id: string) => {
    setPicked(id);
    const r = rosters.find((x) => x.id === id);
    if (!r) return setSeats(empty());
    setName(r.name);
    // Seat each member in their usual role where possible, then fill the rest in order.
    const left = [...r.members];
    const next = roles.map((role) => {
      const i = left.findIndex((m) => m.role === role);
      return { role, handle: i >= 0 ? left.splice(i, 1)[0].handle : "" };
    });
    for (const s of next) if (!s.handle && left.length) s.handle = left.shift()!.handle;
    setSeats(next);
  };
  const roster = rosters.find((x) => x.id === picked);
  const info = (h: string) => roster?.members.find((m) => m.handle.toLowerCase() === h.toLowerCase());

  return (
    <form action={action} className="stack">
      <input type="hidden" name="tournamentId" value={tid} />
      <input type="hidden" name="op" value="registerTeam" />
      <input type="hidden" name="players" value={JSON.stringify(seats)} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Register your team</h3>
        {rosters.length > 0 ? (
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
        )}
      </div>
      <label className="field">
        <span>Team name</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
      </label>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Seat</th>
              <th>Player</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((s, i) => {
              const m = info(s.handle);
              return (
                <tr key={i}>
                  <td className="muted">{s.role}</td>
                  <td>
                    <input
                      value={s.handle}
                      onChange={(e) => setSeats(seats.map((x, j) => (j === i ? { ...x, handle: e.target.value.trim() } : x)))}
                      placeholder="Scheme handle"
                      aria-label={`${s.role} player`}
                      list={roster ? `members-${roster.id}` : undefined}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td className="small">
                    {m ? m.blocker ? <span style={{ color: "var(--bad)" }}>{m.blocker}</span> : <span className="role-ok">{m.rank} ✓</span> : <span className="muted">Checked on submit</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {roster && (
          <datalist id={`members-${roster.id}`}>
            {roster.members.map((m) => (
              <option key={m.handle} value={m.handle} />
            ))}
          </datalist>
        )}
      </div>
      <div>
        <button className="btn primary" disabled={pending || !name.trim() || seats.some((s) => !s.handle)}>
          {pending ? "Registering…" : "Register team"}
        </button>
      </div>
    </form>
  );
}
