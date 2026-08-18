import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@ccj/db/schema";

export type DrizzleClient = PostgresJsDatabase<typeof schema>;

let _client: DrizzleClient | null = null;

export function createDb(connectionString: string): DrizzleClient {
  const isSupabase = connectionString.includes("supabase.co");
  const sql = postgres(connectionString, {
    max: 10, idle_timeout: 20, connect_timeout: 10,
    ssl: isSupabase ? "require" : false,
    onnotice: () => {},
  });
  return drizzle(sql, { schema });
}

export function getDb(): DrizzleClient {
  if (!_client) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is required");
    _client = createDb(url);
  }
  return _client;
}
