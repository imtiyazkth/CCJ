# Authorization Strategy — RLS vs Application-Level

## Current implementation

**The CCJ API uses application-level authorization, not PostgreSQL Row-Level Security.**

### What this means

| Layer | What it does | Active? |
|-------|--------------|---------|
| Application-level auth | Drizzle queries include `WHERE user_id = userId` | ✅ Yes |
| PostgreSQL RLS policies | Defined in migration, not enforced by API | ⚠️ See below |
| Supabase JWT RLS | Enforced when Supabase client used directly | ✅ Yes (web client) |

### Application-level authorization (API)

Every API route handler extracts the authenticated user ID from the verified JWT
and scopes all database queries to that user:

```typescript
// Example from routes/projects.ts
const [project] = await db.select()
  .from(projects)
  .where(eq(projects.userId, userId))   // ← application-level check
  .limit(1);
```

This is the primary security mechanism for the Hono API.

### Why RLS is not active in the API

The API connects to PostgreSQL using the Supabase **service role** (via `DATABASE_URL`),
which bypasses RLS by design. To enable RLS enforcement in API queries, each request
would need to either:

**Option A** — Use a per-request Supabase client with the user's JWT:
```typescript
const userClient = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${userToken}` } }
});
```

**Option B** — Execute `SET LOCAL app.current_user_id = userId` before each Drizzle query:
```typescript
await db.execute(sql`SET LOCAL app.current_user_id = ${userId}`);
```

Neither is currently implemented. This is a **planned hardening step**, not a security
gap for the MVP, because:

1. Application-level authorization is enforced on every route.
2. The service role connection is never exposed to the browser.
3. Supabase RLS (via `auth.uid()`) is active for any direct browser-to-Supabase queries.

### RLS policies in production (Supabase)

The policies defined in `0000_initial.sql` use `ccj_user_id()` which calls `auth.uid()`.
These ARE enforced when:
- The web client uses `@supabase/supabase-js` directly with a user JWT
- Any query reaches Supabase via the anon/user role (not service role)

### CI

RLS is explicitly disabled in `ci_schema.sql`. CI tests run as a superuser.
Authorization logic is tested by verifying that API routes reject requests
for resources belonging to other users.

### Roadmap

- [ ] Increment 4: Switch API to use `SET LOCAL app.current_user_id` for belt-and-suspenders RLS
- [ ] Increment 5: Consider per-request user Supabase client for strict RLS
