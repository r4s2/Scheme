"use client";

import { useActionState, useEffect, useState } from "react";
import { GAMES, maxScore, rankName, type GameId } from "@/engine";
import { removeGame, saveGame, type PoolResult } from "@/app/u/[handle]/actions";
import { withNotice } from "@/components/Toaster";
import { GameBadge } from "@/components/ui/bits";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import type { GameAccount } from "@/server/model";

const save = withNotice(saveGame);
const remove = withNotice(removeGame);

const ACCOUNT_LABEL: Record<GameId, string> = { val: "Riot ID", lol: "Riot ID", ow: "BattleTag", mr: "Marvel Rivals UID" };
const ACCOUNT_HINT: Record<GameId, string> = { val: "name#TAG", lol: "name#TAG", ow: "Name#1234", mr: "UID 123456789" };

/** Tier and division indexes for a ladder score. */
function split(game: GameId, score: number): [number, number] {
  const G = GAMES[game];
  if (score >= maxScore(game)) return [G.tiers.length - 1, 0];
  return [Math.floor(score / G.divisions.length), score % G.divisions.length];
}

/** Add or edit one game: account, rank (unless verified) and roles. */
function GameForm({ choices = [], account, onDone }: { choices?: GameId[]; account?: GameAccount; onDone: () => void }) {
  const [g, setG] = useState<GameId | "">(account?.game ?? (choices.length === 1 ? choices[0] : ""));
  const [result, action, pending] = useActionState<PoolResult | null, FormData>(save, null);
  useEffect(() => {
    if (result?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const G = g ? GAMES[g] : null;
  const [t0, d0] = account ? split(account.game, account.rankScore) : [0, 0];
  const [tier, setTier] = useState(t0);
  const verified = account?.source === "api";

  return (
    <form action={action} className="gform">
      {account ? (
        <input type="hidden" name="game" value={account.game} />
      ) : (
        <label className="field">
          <span>Game</span>
          <select name="game" value={g} onChange={(e) => setG(e.target.value as GameId)} required>
            <option value="" disabled>
              Pick a game…
            </option>
            {choices.map((x) => (
              <option key={x} value={x}>
                {GAMES[x].name}
              </option>
            ))}
          </select>
        </label>
      )}
      {G && g && (
        <>
          {verified ? (
            <>
              <input type="hidden" name="accountName" value={account!.accountName} />
              <input type="hidden" name="tier" value={t0} />
              <input type="hidden" name="division" value={d0} />
              <p className="small muted">
                {account!.accountName} · {rankName(g, account!.rankScore)}, verified through {G.rankSource.split(" via ")[0]}. Rank updates come from there.
              </p>
            </>
          ) : (
            <>
              <label className="field">
                <span>
                  {ACCOUNT_LABEL[g]} <span className="help">{ACCOUNT_HINT[g]}</span>
                </span>
                <input name="accountName" defaultValue={account?.accountName ?? ""} required minLength={3} maxLength={40} autoComplete="off" />
              </label>
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span>Rank</span>
                  <select name="tier" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                    {G.tiers.map((t, i) => (
                      <option key={t} value={i}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                {tier < G.tiers.length - 1 && (
                  <label className="field" style={{ flex: 1 }}>
                    <span>Division</span>
                    <select name="division" defaultValue={d0}>
                      {G.divisions.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="tiny muted">Self-reported until you link the account with sign-in. {g === "mr" ? "Hosts may ask for a screenshot." : ""}</p>
            </>
          )}
          <fieldset>
            <legend>Roles you play</legend>
            <div className="roles">
              {G.roleOptions.map((r) => (
                <label key={r}>
                  <input type="checkbox" name="roles" value={r} defaultChecked={account ? account.roles.includes(r) : false} /> {r}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <div className="row">
        <button className="btn sm primary" disabled={pending || !g}>
          {pending ? "Saving…" : account ? "Save" : "Add game"}
        </button>
        <button type="button" className="btn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemoveButton({ game }: { game: GameId }) {
  const [sure, setSure] = useState(false);
  const [, action, pending] = useActionState<PoolResult | null, FormData>(remove, null);
  if (!sure) {
    return (
      <button type="button" className="btn xs ghost danger" onClick={() => setSure(true)}>
        Remove
      </button>
    );
  }
  return (
    <form action={action} className="row" style={{ gap: 6 }}>
      <input type="hidden" name="game" value={game} />
      <button className="btn xs danger" disabled={pending}>
        {pending ? "Removing…" : `Remove ${GAMES[game].name}`}
      </button>
      <button type="button" className="btn xs ghost" onClick={() => setSure(false)}>
        Keep
      </button>
    </form>
  );
}

/**
 * The profile's game pool: one card per linked game. On your own profile
 * each card can be edited or removed, and games you don't have yet can be added.
 */
export function GamePool({ accounts, editable }: { accounts: GameAccount[]; editable: boolean }) {
  const [editing, setEditing] = useState<GameId | "new" | null>(null);
  const missing = (Object.keys(GAMES) as GameId[]).filter((g) => !accounts.some((a) => a.game === g));

  return (
    <>
      {accounts.length === 0 && editing !== "new" && <div className="empty">{editable ? "No games yet. Add the games you play so captains and hosts can see your rank." : "No linked game accounts yet."}</div>}
      <div className="pool">
        {accounts.map((a) => (
          <div key={a.game} className="card gcard">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <GameBadge game={a.game} />
              {a.source === "api" ? (
                <span className="pill good">
                  <CheckIcon />
                  Verified
                </span>
              ) : (
                <span className="pill warn">
                  <WarnIcon />
                  Self-reported
                </span>
              )}
            </div>
            {editing === a.game ? (
              <GameForm account={a} onDone={() => setEditing(null)} />
            ) : (
              <>
                <div className="rank">{rankName(a.game, a.rankScore)}</div>
                <dl className="kv">
                  <dt>Account</dt>
                  <dd className="mono">{a.accountName}</dd>
                  <dt>Roles</dt>
                  <dd>{a.roles.join(", ") || "—"}</dd>
                  <dt>Source</dt>
                  <dd>{a.source === "api" ? GAMES[a.game].rankSource : "Self-reported"}</dd>
                </dl>
                {editable && (
                  <div className="row" style={{ justifyContent: "space-between", marginTop: "auto" }}>
                    <button type="button" className="btn xs" onClick={() => setEditing(a.game)}>
                      Edit
                    </button>
                    <RemoveButton game={a.game} />
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {editable && missing.length > 0 && (
          <div className="card gcard" style={editing === "new" ? undefined : { borderStyle: "dashed", background: "none", justifyContent: "center", alignItems: "center", minHeight: 120 }}>
            {editing === "new" ? (
              <>
                <b>Add a game</b>
                <GameForm choices={missing} onDone={() => setEditing(null)} />
              </>
            ) : (
              <button type="button" className="btn sm" onClick={() => setEditing("new")}>
                + Add a game
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
