import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Scheme</h1>
      <p className={styles.lead}>
        Find, host and run esports tournaments for Valorant, League of Legends, Overwatch and Marvel Rivals, with verified
        ranks, balanced teams and an AI co-pilot for hosts. This is the start of the real app; the clickable prototype shows
        where it is headed.
      </p>
      <div className={styles.links}>
        <Link className={`${styles.link} ${styles.primary}`} href="/demo">
          See the bracket engine
        </Link>
      </div>
    </main>
  );
}
