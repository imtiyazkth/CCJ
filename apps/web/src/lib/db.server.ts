import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@ccj/db/schema";

// Singleton — reused across requests in the same Vercel function instance
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  // Use max:1 for serverless — each function instance gets one connection
  const client = postgres(url, {
    max: 1,
    ssl: "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });
  _db = drizzle(client, { schema });
  return _db;
}
