import "server-only";
import { demoProfiles, demoRosters, demoTournaments } from "../demo-data";
import { FallbackStore } from "./fallback";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

export * from "./types";
export { DatabaseUnavailableError } from "./fallback";

type Cache = { __schemeStore?: Store; __schemeStoreUrl?: string };

/**
 * Where data comes from right now:
 * - "database": DATABASE_URL is set and the database is reachable.
 * - "demo": no DATABASE_URL, so the built-in demo data is used.
 * - "offline": development only. DATABASE_URL is set but the database can't
 *   be reached from this network, so demo data stands in until it can.
 */
export type StoreMode = "database" | "demo" | "offline";

const demo = () => {
  const all = demoTournaments(new Date());
  return new MemoryStore(all, demoProfiles(all), demoRosters());
};

/** In development, fall back to demo data when the database can't be reached. Never in production. */
function fallbackEnabled() {
  return process.env.NODE_ENV !== "production";
}

/**
 * The store for this server process, cached on globalThis so dev-server
 * reloads keep the same data. It is rebuilt when DATABASE_URL changes, so
 * editing .env.local takes effect without restarting.
 */
export function getStore(): Store {
  const g = globalThis as unknown as Cache;
  const url = process.env.DATABASE_URL || "";
  if (!g.__schemeStore || g.__schemeStoreUrl !== url) {
    const old = g.__schemeStore;
    // Duck-typed: after a dev reload the cached store may come from an older copy of these classes.
    const closable = old as { close?: () => Promise<void> } | undefined;
    void closable?.close?.().catch(() => {});
    g.__schemeStoreUrl = url;
    g.__schemeStore = !url
      ? demo()
      : fallbackEnabled()
        ? new FallbackStore(PostgresStore.fromUrl(url), demo, () => PostgresStore.ping(url), {
            onChange: (online, reason) =>
              console.warn(
                online
                  ? "[scheme] Connected to the database."
                  : `[scheme] Can't reach the database (${reason ?? "unknown error"}). Showing demo data; retrying every 30 seconds.`,
              ),
          })
        : PostgresStore.fromUrl(url);
  }
  return g.__schemeStore;
}

/** Call after a store read so the answer reflects the latest connection check. */
export function storeMode(): StoreMode {
  const s = getStore() as Store & { online?: boolean; close?: unknown };
  if (typeof s.online === "boolean") return s.online ? "database" : "offline";
  return typeof s.close === "function" ? "database" : "demo";
}
