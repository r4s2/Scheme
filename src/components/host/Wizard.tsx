"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { blockedNameTerms, FORMAT_NAMES, GAMES, suggestNames, tierCeiling, tierFloor, type ComplianceIssue, type FormatId, type GameId } from "@/engine";
import { publishTournament } from "@/app/host/actions";
import { toast } from "@/components/Toaster";
import { GameDot } from "@/components/ui/bits";
import { BlockIcon, CheckIcon, InfoIcon, WarnIcon } from "@/components/ui/icons";
import { possessive } from "@/lib/format";
import { draftIssues, draftRoles, newDraft, REGIONS, SIZES, type Draft } from "@/server/create";

const STEPS = ["Game and name", "Format", "Registration", "Requirements", "Schedule and rules", "Entry and prizes", "Review and publish"];
const FORMAT_HELP: Record<FormatId, string> = {
  single: "Lose once and you're out. Fastest.",
  double: "Everyone gets a second life in the lower bracket.",
  rr: "Everyone plays everyone. Best for small groups.",
  swiss: "Teams with the same record meet each round. No eliminations.",
  groups: "Round-robin groups, then a playoff bracket.",
};
const STORAGE_KEY = "scheme:host-draft";
const money = (n: number) => `$${n.toFixed(2)}`;

/** datetime-local value in the viewer's time zone, and back. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Wizard({ hostKarma, now: nowIso }: { hostKarma: number; now: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const router = useRouter();
  const [d, setD] = useState<Draft>(() => newDraft(now));
  // The section in view, highlighted in the side list.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-wiz]")];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(Number((top.target as HTMLElement).dataset.wiz));
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const [pending, start] = useTransition();

  // Keep the draft in this browser so a refresh doesn't lose it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setD((cur) => ({ ...cur, ...JSON.parse(saved) }));
    } catch {
      // Storage unavailable: start fresh.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch {
      // Ignore: the draft just won't survive a refresh.
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const G = GAMES[d.game];
  const issues = draftIssues(d, hostKarma, now);
  const blocks = issues.filter((i) => i.level === "block");
  const roles = draftRoles(d);
  const hits = d.name.trim() ? blockedNameTerms(d.game, d.name) : [];

  const publish = () =>
    start(async () => {
      let res: Awaited<ReturnType<typeof publishTournament>>;
      try {
        res = await publishTournament(d);
      } catch {
        return toast({ message: "Couldn't publish just now. Your draft is saved here; try again in a moment.", tone: "err" });
      }
      if (!res.ok) return toast({ message: res.message, tone: "err" });
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to clear.
      }
      toast({ message: res.message });
      router.push(`/t/${res.id}`);
    });

  const radio = <V extends string>(name: string, value: V, current: V, title: React.ReactNode, desc: string, onPick: (v: V) => void) => (
    <label className="opt" key={value}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onPick(value)} />
      <b>{title}</b>
      {desc && <span>{desc}</span>}
    </label>
  );

  const section = (step: number): React.ReactNode => {
    let body: React.ReactNode = null;
    switch (step) {
      case 0:
        body = (
          <>
            <h2>Game and name</h2>
            <p className="lead">Pick the game first. Naming rules change by publisher.</p>
            <div className="opts">
              {(Object.keys(GAMES) as GameId[]).map((g) =>
                radio(
                  "game",
                  g,
                  d.game,
                  <>
                    <GameDot game={g} /> {GAMES[g].name}
                  </>,
                  `${GAMES[g].roles.length}v${GAMES[g].roles.length} · Ranks: ${GAMES[g].rankSource}`,
                  (v) => setD((x) => ({ ...x, game: v, rankMinTier: Math.min(x.rankMinTier, GAMES[v].tiers.length - 1), rankMaxTier: Math.min(x.rankMaxTier, GAMES[v].tiers.length - 1), owSixes: v === "ow" && x.owSixes })),
                ),
              )}
            </div>
            <label className="field" style={{ marginTop: 18 }}>
              <span>Event name</span>
              <input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={d.game === "mr" ? "Try “Saturday Night Cup” to see the name check" : "Friday Night Showdown"} autoComplete="off" maxLength={80} />
            </label>
            {d.name.trim() && (
              <div className={`namecheck ${hits.length ? "bad" : "ok"}`} role="status">
                {hits.length ? (
                  <>
                    {possessive(G.name)} publisher doesn&apos;t allow “{hits.join("”, “")}” in community event names. Try:
                    <div className="sugg">
                      {suggestNames(d.name, hits).map((s) => (
                        <button key={s} type="button" className="chip" onClick={() => set("name", s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  "Name passes every publisher check."
                )}
              </div>
            )}
          </>
        );
        break;
      case 1:
        body = (
          <>
            <h2>Format</h2>
            <p className="lead">You can transform the bracket into any other format later, until results go past round one.</p>
            <div className="opts">{(Object.keys(FORMAT_NAMES) as FormatId[]).map((f) => radio("format", f, d.format, FORMAT_NAMES[f], FORMAT_HELP[f], (v) => set("format", v)))}</div>
            <div className="grid2" style={{ marginTop: 18 }}>
              <label className="field">
                <span>Teams in the bracket</span>
                <select value={d.teamCount} onChange={(e) => set("teamCount", Number(e.target.value) as Draft["teamCount"])}>
                  {SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Series length</span>
                <select value={d.bestOf} onChange={(e) => set("bestOf", Number(e.target.value) as Draft["bestOf"])}>
                  {[1, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      Best of {n}
                    </option>
                  ))}
                </select>
              </label>
              {d.game === "ow" && (
                <label className="field">
                  <span>Team size</span>
                  <select value={d.owSixes ? "6" : "5"} onChange={(e) => set("owSixes", e.target.value === "6")}>
                    <option value="5">5v5 (current competitive)</option>
                    <option value="6">6v6</option>
                  </select>
                </label>
              )}
            </div>
          </>
        );
        break;
      case 2:
        body = (
          <>
            <h2>Registration</h2>
            <p className="lead">How players get into the event.</p>
            <div className="opts">
              {radio("signup", "team", d.signupType, "Team sign-up", "Captains register a saved roster in one step.", (v) => set("signupType", v))}
              {radio("signup", "solo", d.signupType, "Solo sign-up", "Players join alone. Scheme builds the teams.", (v) => set("signupType", v))}
            </div>
            {d.signupType === "solo" && (
              <>
                <h3 style={{ fontSize: 15, margin: "20px 0 8px" }}>How should teams be built?</h3>
                <div className="opts">
                  {radio("balance", "even", d.balanceGoal, "Even teams", "Every team has a similar average rank and every role filled.", (v) => set("balanceGoal", v))}
                  {radio("balance", "tiers", d.balanceGoal, "Rank tiers", "Players are grouped with others near their rank.", (v) => set("balanceGoal", v))}
                </div>
              </>
            )}
          </>
        );
        break;
      case 3:
        body = (
          <>
            <h2>Requirements</h2>
            <p className="lead">Checked automatically against each player&apos;s linked account.</p>
            <div className="grid2">
              <label className="field">
                <span>Rank floor</span>
                <select value={d.rankMinTier} onChange={(e) => set("rankMinTier", Number(e.target.value))}>
                  {G.tiers.map((t, i) => (
                    <option key={t} value={i}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Rank ceiling</span>
                <select value={d.rankMaxTier} onChange={(e) => set("rankMaxTier", Number(e.target.value))}>
                  {G.tiers.map((t, i) => (
                    <option key={t} value={i}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Minimum player karma <span className="help">0 to 100</span>
                </span>
                <input type="number" min={0} max={100} value={d.minKarma} onChange={(e) => set("minKarma", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              </label>
              <label className="field">
                <span>Region</span>
                <select value={d.region} onChange={(e) => set("region", e.target.value)}>
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={d.verifiedOnly || d.paid} disabled={d.paid} onChange={(e) => set("verifiedOnly", e.target.checked)} />
              <span>
                Verified ranks only{d.paid && <span className="muted small"> (required for paid events)</span>}
                {d.game === "mr" && <span className="muted small"> · Marvel Rivals ranks are self-reported with a screenshot for now</span>}
              </span>
            </label>
          </>
        );
        break;
      case 4:
        body = (
          <>
            <h2>Schedule and rules</h2>
            <p className="lead">Deadlines drive reminders and forfeits. Players see every time in their own time zone.</p>
            <div className="grid2">
              <label className="field">
                <span>Start</span>
                <input type="datetime-local" value={toLocalInput(d.startsAt)} onChange={(e) => e.target.value && set("startsAt", new Date(e.target.value).toISOString())} />
              </label>
              <label className="field">
                <span>Check-in opens</span>
                <select value={d.checkinMinutes} onChange={(e) => set("checkinMinutes", Number(e.target.value))}>
                  {[30, 60, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes before
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Match deadline</span>
                <select value={d.matchWindowHours} onChange={(e) => set("matchWindowHours", Number(e.target.value))}>
                  {[12, 24, 48].map((n) => (
                    <option key={n} value={n}>
                      {n} hours per round
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={d.allowExtensions} onChange={(e) => set("allowExtensions", e.target.checked)} />
              <span>Let players request extensions. If off, a missed deadline is a forfeit.</span>
            </label>
            <label className="field" style={{ marginTop: 16 }}>
              <span>
                House rules <span className="help">One per line. Added to every match&apos;s lobby instructions.</span>
              </span>
              <textarea rows={4} value={d.houseRules} onChange={(e) => set("houseRules", e.target.value)} placeholder="No pauses except for disconnects" />
            </label>
          </>
        );
        break;
      case 5: {
        const pool = d.entryFeeDollars * d.teamCount * (1 - d.withholdPct / 100);
        body = (
          <>
            <h2>Entry and prizes</h2>
            <p className="lead">Free events are always free to host. You can also add a non-cash prize when you close the event.</p>
            <div className="opts">
              {radio("paid", "free", d.paid ? "paid" : "free", "Free entry", "No money changes hands.", () => set("paid", false))}
              {radio("paid", "paid", d.paid ? "paid" : "free", "Paid entry", "Captains pay at registration. Winners are paid out by Scheme.", () => set("paid", true))}
            </div>
            {d.paid && (
              <>
                <div className="grid2" style={{ marginTop: 18 }}>
                  <label className="field">
                    <span>Entry fee per team (USD)</span>
                    <input type="number" min={1} value={d.entryFeeDollars} onChange={(e) => set("entryFeeDollars", Math.max(0, Number(e.target.value) || 0))} />
                  </label>
                  <label className="field">
                    <span>
                      Held for event costs <span className="help">% of fees</span>
                    </span>
                    <input type="number" min={0} max={50} value={d.withholdPct} onChange={(e) => set("withholdPct", Math.max(0, Math.min(50, Number(e.target.value) || 0)))} />
                  </label>
                </div>
                <h3 style={{ fontSize: 15, margin: "18px 0 8px" }}>Payout split</h3>
                <div className="grid2">
                  {["1st", "2nd", "3rd"].map((p, i) => (
                    <label key={p} className="field">
                      <span>{p} place %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={d.split[i]}
                        onChange={(e) => {
                          const split = [...d.split] as Draft["split"];
                          split[i] = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          set("split", split);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="card panel" style={{ marginTop: 16, background: "var(--surface-2)" }}>
                  <dl className="kv">
                    <dt>Prize pool</dt>
                    <dd className="mono">
                      {money(pool)} if all {d.teamCount} teams register
                    </dd>
                    {["1st", "2nd", "3rd"].map((p, i) => (
                      <span key={p} style={{ display: "contents" }}>
                        <dt>{p}</dt>
                        <dd className="mono">{money((pool * d.split[i]) / 100)}</dd>
                      </span>
                    ))}
                    <dt>Scheme fee</dt>
                    <dd>Added on top at checkout, so the pool stays whole</dd>
                    <dt>Who holds the money</dt>
                    <dd>Scheme&apos;s payment partner, until payouts release. Scheme never holds a balance.</dd>
                  </dl>
                </div>
              </>
            )}
          </>
        );
        break;
      }
      default: {
        const pub = G.publisher === "riot" ? "Riot's" : G.publisher === "blizzard" ? "Blizzard's" : "NetEase's";
        body = (
          <>
            <h2>Review and publish</h2>
            <p className="lead">Scheme checks the event against {pub} community rules before it goes live.</p>
            <dl className="kv" style={{ marginBottom: 18 }}>
              <dt>Name</dt>
              <dd>{d.name.trim() || "—"}</dd>
              <dt>Game</dt>
              <dd>
                {G.name} · {roles.length}v{roles.length}
              </dd>
              <dt>Format</dt>
              <dd>
                {FORMAT_NAMES[d.format]} · {d.teamCount} teams · Bo{d.bestOf}
              </dd>
              <dt>Sign-up</dt>
              <dd>{d.signupType === "solo" ? `Solo, ${d.balanceGoal === "even" ? "even teams" : "rank tiers"}` : "Teams"}</dd>
              <dt>Ranks</dt>
              <dd>
                {G.tiers[d.rankMinTier]} to {G.tiers[d.rankMaxTier]} ({tierCeiling(d.game, d.rankMaxTier) - tierFloor(d.game, d.rankMinTier) + 1} divisions)
                {d.verifiedOnly || d.paid ? ", verified only" : ""}
              </dd>
              <dt>Starts</dt>
              <dd>{new Date(d.startsAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</dd>
              <dt>Entry</dt>
              <dd>{d.paid ? `${money(d.entryFeeDollars)} per team` : "Free"}</dd>
            </dl>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Compliance check</h3>
            <Issues issues={issues} />
            {G.publisher === "riot" && (
              <label className="check" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={d.riotFormAck} onChange={(e) => set("riotFormAck", e.target.checked)} />
                <span>I&apos;ll submit Riot&apos;s community event visibility form for this event.</span>
              </label>
            )}
          </>
        );
      }
    }
    return body;
  };

  return (
    <div className="wiz">
      <div className="wiz-rail">
        <ol className="card wsteps" aria-label="Sections">
          {STEPS.map((s, i) => (
            <li key={s}>
              <a href={`#wiz-${i}`} aria-current={i === active ? "step" : undefined} onClick={() => setActive(i)}>
                <span className="n">{i + 1}</span>
                {s}
              </a>
            </li>
          ))}
        </ol>
        <div className="card rail-comp">
          <div className="label" style={{ marginBottom: 6 }}>
            Compliance
          </div>
          <p className="small">
            {blocks.length ? <span className="pill bad">{blocks.length} to fix</span> : <span className="pill good">Ready</span>} <span className="muted">{G.name} rules</span>
          </p>
          {blocks.length > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>{blocks[0].message}</p>}
          <button type="button" className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} disabled={!!blocks.length || pending} onClick={publish}>
            {pending ? "Publishing…" : "Publish tournament"}
          </button>
        </div>
      </div>
      <form
        className="card wbody wiz-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocks.length) publish();
        }}
      >
        {STEPS.map((s, i) => (
          <section key={s} id={`wiz-${i}`} data-wiz={i} className="wiz-section">
            {section(i)}
          </section>
        ))}
        <div className="wnav">
          <span className="small muted">{blocks.length ? `${blocks.length} thing${blocks.length === 1 ? "" : "s"} to fix before publishing.` : "Everything checks out."}</span>
          <button className="btn primary" disabled={!!blocks.length || pending}>
            {pending ? "Publishing…" : "Publish tournament"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Issues({ issues }: { issues: ComplianceIssue[] }) {
  const icon = (l: ComplianceIssue["level"]) => (l === "ok" ? <CheckIcon /> : l === "info" ? <InfoIcon /> : l === "block" ? <BlockIcon /> : <WarnIcon />);
  return (
    <ul className="comp">
      {issues.map((x) => (
        <li key={x.code} className={x.level}>
          {icon(x.level)}
          <span>{x.message}</span>
        </li>
      ))}
    </ul>
  );
}
