import Link from "next/link";
import { setActor } from "@/app/actions";
import { getStore } from "@/server/store";
import { actingAsEnabled, currentActor } from "@/server/session";
import ui from "./ui.module.css";

/** Everyone who appears in a tournament, for the development "acting as" switcher. */
async function knownPeople(): Promise<{ handle: string; label: string }[]> {
  const store = getStore();
  const out = new Map<string, string>();
  for (const s of await store.list()) {
    const t = await store.get(s.id);
    if (!t) continue;
    if (!out.has(t.host)) out.set(t.host, `${t.host} · host`);
    for (const team of Object.values(t.state.teams)) {
      for (const p of team.players) if (!out.has(p.handle)) out.set(p.handle, `${p.handle} · ${team.name}${p.handle === team.captain ? " captain" : ""}`);
    }
  }
  return [...out].map(([handle, label]) => ({ handle, label })).sort((a, b) => Number(b.label.includes("host")) - Number(a.label.includes("host")) || Number(b.label.includes("captain")) - Number(a.label.includes("captain")) || a.handle.localeCompare(b.handle));
}

export async function Header() {
  const actor = await currentActor();
  const unread = actor ? (await getStore().notifications(actor)).filter((n) => !n.read).length : 0;
  const people = actingAsEnabled() ? await knownPeople() : [];
  return (
    <header className={ui.topbar}>
      <div className={ui.topbarInner}>
        <Link href="/" className={ui.brand}>
          scheme
        </Link>
        <nav className={ui.nav} aria-label="Main">
          <Link href="/">Tournaments</Link>
          <Link href="/demo">Engine demo</Link>
          {actor && (
            <Link href="/notifications">
              Notifications{unread ? <span className={ui.count}>{unread}</span> : null}
            </Link>
          )}
        </nav>
        {actingAsEnabled() && (
          <form action={setActor} className={ui.devbar}>
            <label htmlFor="acting-as">Acting as (dev only)</label>
            <select id="acting-as" name="handle" defaultValue={actor ?? undefined}>
              {people.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className={ui.btn}>Switch</button>
          </form>
        )}
      </div>
    </header>
  );
}
