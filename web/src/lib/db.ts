import { Pool, PoolClient } from "pg";

/**
 * Two-pool model (mirrors Supabase):
 *  - adminPool  → privileged role, BYPASSES RLS. Used ONLY for auth
 *    (credentials, sessions) and tenant provisioning (signup/onboarding).
 *  - appPool    → `sahla_app` role, RLS ENFORCED. All business queries
 *    run through withTenant(), which sets request.jwt.claim.sub for the
 *    transaction — exactly how Supabase scopes auth.uid().
 */

declare global {
  // eslint-disable-next-line no-var
  var __sahlaPools: { admin: Pool; app: Pool } | undefined;
}

function makePools() {
  const admin = new Pool({
    connectionString:
      process.env.DATABASE_URL_ADMIN ??
      "postgresql://postgres@localhost/sahla?host=/tmp",
    max: 5,
  });
  const app = new Pool({
    connectionString:
      process.env.DATABASE_URL_APP ??
      "postgresql://sahla_app:sahla_app_local_dev@localhost/sahla?host=/tmp",
    max: 10,
  });
  return { admin, app };
}

const pools = (globalThis.__sahlaPools ??= makePools());

export const adminPool = pools.admin;

/** Run `fn` inside a transaction scoped to `userId` (RLS enforced). */
export async function withTenant<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pools.app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
