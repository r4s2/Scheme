import { notFound } from "next/navigation";
import { BracketView } from "@/components/BracketView";
import { FORMAT_NAMES, GAMES } from "@/engine";
import { loadTournament } from "@/lib/db/tournaments";
import { createServerSupabase } from "@/lib/supabase/server";
import styles from "../../page.module.css";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) {
    return (
      <main className={styles.page}>
        <div className={styles.notice}>
          Supabase isn&apos;t configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in your project
          keys. See the README.
        </div>
      </main>
    );
  }
  const t = await loadTournament(supabase, id);
  if (!t) notFound();
  const { state } = t.engine;
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t.name}</h1>
      <p className={styles.meta}>
        {GAMES[t.game].name} · {FORMAT_NAMES[state.format]} · Bo{state.bestOf} · {t.region} · {t.status}
      </p>
      <BracketView state={state} game={t.game} />
    </main>
  );
}
