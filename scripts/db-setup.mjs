// Sets up the database in DATABASE_URL: applies any schema changes it doesn't
// have yet, then loads the sample data (unless --no-seed). Safe to run again;
// it only does what's missing.
//
//   npm run db:setup              schema + sample data (development projects)
//   npm run db:setup -- --no-seed schema only
//
// Applied changes are recorded in supabase_migrations.schema_migrations, the
// same table the Supabase CLI uses, so `supabase db push` agrees with it.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = !process.argv.includes("--no-seed");
try {
  process.loadEnvFile(join(root, ".env.local"));
} catch {
  // No .env.local: rely on the environment.
}
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL isn't set. Add it to .env.local (see .env.example), then run this again.");
  process.exit(1);
}

let host = "";
try {
  host = new URL(url).hostname;
} catch {
  console.error("DATABASE_URL isn't a valid connection string.");
  process.exit(1);
}
const supabase = host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
const sslmode = new URL(url).searchParams.get("sslmode");

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
  ...(supabase && !sslmode ? { ssl: "require" } : {}),
});

// Schema changes that may have been applied by hand (in the SQL Editor) before
// this script existed, and how to tell they're fully there. Anything applied
// by this script is recorded, so later changes don't need an entry.
const APPLIED_BY_HAND = {
  "20261009000000": (tx) => tx`
    select to_regclass('public.tournaments') is not null
       and to_regclass('public.payouts') is not null
       and exists (select 1 from pg_trigger where tgname = 'tournaments_touch') as ok`,
  "20261010000000": (tx) => tx`
    select exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'tournaments' and column_name = 'version') as ok`,
};

async function main() {
  try {
    await sql`select 1`;
  } catch (e) {
    console.error(`Couldn't reach the database at ${host} (${e.code ?? e.message}).`);
    console.error("If you're on guest or office Wi-Fi, it may block database traffic. Try another network.");
    process.exit(1);
  }
  console.log(`Connected to ${host}.`);

  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`;
  const done = new Set((await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version));

  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    const name = rest.join("_");
    if (done.has(version)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }
    const record = (tx) => tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${name}) on conflict do nothing`;
    const check = APPLIED_BY_HAND[version];
    if (check && (await check(sql))[0].ok) {
      await record(sql);
      console.log(`  ✓ ${file} (was already in the database; marked as applied)`);
      continue;
    }
    const text = readFileSync(join(dir, file), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(text).simple();
        await record(tx);
      });
      console.log(`  + ${file} (applied)`);
    } catch (e) {
      throw Object.assign(e, { file });
    }
  }

  if (seed) {
    await sql.begin((tx) => tx.unsafe(readFileSync(join(root, "supabase", "seed.sql"), "utf8")).simple());
    console.log("  + sample data loaded (rows that already existed were left alone)");
  }

  const [{ tournaments, profiles }] = await sql`
    select (select count(*) from tournaments where status <> 'draft')::int as tournaments,
           (select count(*) from profiles)::int as profiles`;
  console.log(`Done: ${tournaments} tournament(s) and ${profiles} player profile(s) in the database.`);
}

main()
  .catch((e) => {
    console.error(`Setup stopped${e.file ? ` at ${e.file}` : ""}: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 2 }));
