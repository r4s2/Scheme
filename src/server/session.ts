import "server-only";
import { cookies } from "next/headers";

export const ACTOR_COOKIE = "scheme_actor";
export const DEFAULT_ACTOR = "kestrel";

/**
 * Who is acting. Until Supabase Auth is wired in, development builds let you
 * pick anyone with the "Acting as" switcher. Production returns null (read
 * only) unless SCHEME_DEV_ACTORS=1 is set for a private demo deployment.
 */
export function actingAsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SCHEME_DEV_ACTORS === "1";
}

export async function currentActor(): Promise<string | null> {
  if (!actingAsEnabled()) return null;
  const jar = await cookies();
  return jar.get(ACTOR_COOKIE)?.value || DEFAULT_ACTOR;
}
