import Link from "next/link";
import { BracketView } from "@/components/BracketView";
import { FORMAT_NAMES, type FormatId } from "@/engine";
import { sampleTournament } from "@/lib/sample";
import styles from "../page.module.css";

const FORMATS = Object.keys(FORMAT_NAMES) as FormatId[];

export default async function Demo({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const { format: f } = await searchParams;
  const format: FormatId = FORMATS.includes(f as FormatId) ? (f as FormatId) : "single";
  const base = sampleTournament();
  // Only first-round results carry over when the format changes.
  const state = { ...base, format, results: format === "single" ? base.results : {} };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Friday Night Spike</h1>
      <p className={styles.meta}>Sample data · Valorant · {FORMAT_NAMES[format]} · rendered by the engine in src/engine</p>
      <div className={styles.links} style={{ marginBottom: 16 }}>
        {FORMATS.map((k) => (
          <Link key={k} className={`${styles.link} ${k === format ? styles.primary : ""}`} href={`/demo?format=${k}`}>
            {FORMAT_NAMES[k]}
          </Link>
        ))}
      </div>
      <BracketView state={state} game="val" />
    </main>
  );
}
