import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";

const schema = z.object({
  roleId: z.string().uuid().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("users.manage");
  const id = pathId(req);
  const body = await parseBody(req, schema);
  const existing = await db.query(
    `select m.*, u.full_name from company_members m join users u on u.id = m.user_id
     where m.id = $1 and m.company_id = $2`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Member");
  if (existing.rows[0].is_owner) {
    throw new ApiError(409, "OWNER_LOCKED", "The owner's access cannot be modified.");
  }
  if (body.roleId) {
    const role = await db.query(`select 1 from roles where id = $1 and company_id = $2`, [body.roleId, companyId]);
    if (!role.rowCount) throw notFound("Role");
    await db.query(`update company_members set role_id = $1 where id = $2`, [body.roleId, id]);
  }
  if (body.status) {
    await db.query(`update company_members set status = $1 where id = $2`, [body.status, id]);
  }
  await audit({
    action: "update", entityType: "member", entityId: existing.rows[0].user_id,
    entityLabel: existing.rows[0].full_name,
    oldValues: { roleId: existing.rows[0].role_id, status: existing.rows[0].status },
    newValues: body,
  });
  return { ok: true };
});
