import { withPlatformAdmin } from "@/lib/adminApi";
import { adminPool } from "@/lib/db";
import { pathId, notFound } from "@/lib/api";

export const POST = withPlatformAdmin(async ({ req, paudit }) => {
  const id = pathId(req, 1);
  const r = await adminPool.query(
    `update companies set suspended_at = null, suspension_reason = null
     where id = $1 and deleted_at is null returning name`,
    [id]
  );
  if (!r.rowCount) throw notFound("Company");
  await paudit("activate_company", id, { name: r.rows[0].name });
  return { ok: true };
});
