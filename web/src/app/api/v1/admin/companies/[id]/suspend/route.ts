import { z } from "zod";
import { withPlatformAdmin } from "@/lib/adminApi";
import { adminPool } from "@/lib/db";
import { parseBody, pathId, notFound } from "@/lib/api";

const schema = z.object({ reason: z.string().min(3).max(300) });

export const POST = withPlatformAdmin(async ({ req, paudit }) => {
  const id = pathId(req, 1);
  const { reason } = await parseBody(req, schema);
  const r = await adminPool.query(
    `update companies set suspended_at = now(), suspension_reason = $1
     where id = $2 and deleted_at is null returning name`,
    [reason, id]
  );
  if (!r.rowCount) throw notFound("Company");
  await paudit("suspend_company", id, { name: r.rows[0].name, reason });
  return { ok: true };
});
