import "server-only";
import { demoTournaments } from "../demo-data";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

export * from "./types";

/**
 * The store for this server process: Postgres when DATABASE_URL is set,
 * otherwise an in-memory store seeded with demo tournaments. Cached on
 * globalThis so dev-server reloads keep the same data.
 */
export function getStore(): Store {
  const g = globalThis as unknown as { __schemeStore?: Store };
  if (!g.__schemeStore) {
    const url = process.env.DATABASE_URL;
    g.__schemeStore = url ? PostgresStore.fromUrl(url) : new MemoryStore(demoTournaments(new Date()));
  }
  return g.__schemeStore;
}

export function isDemoStore(): boolean {
  return !process.env.DATABASE_URL;
}
