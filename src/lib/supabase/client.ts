"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Supabase client for Client Components. Row-level security applies. */
export function createBrowserSupabase() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase isn't configured. Copy .env.example to .env.local.");
  return createBrowserClient(env.url, env.anonKey);
}
