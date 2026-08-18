import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load .env from monorepo root (two levels up from packages/db)
dotenv.config({ path: "../../.env" });

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required in .env to run migrations");
}

export default {
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
  // Supabase uses the public schema by default
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
} satisfies Config;
