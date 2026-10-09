import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Acts as the signed-in user, so row-level security applies.
 */
export async function createServerSupabase() {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. Middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Service-role client for trusted server code only: results, ranks, karma,
 * money. Every caller must check permissions and run the engine first.
 * Never import this from client code.
 */
export function createServiceSupabase() {
  const env = supabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return createAdminClient(env.url, key, { auth: { persistSession: false } });
}
