import { z } from "zod";
import { withApi, parseBody, pathId, notFound, badRequest } from "@/lib/api";

const schema = z.object({ courierId: z.string().uuid().nullable() });

export const POST = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("deliveries.assign");
  const id = pathId(req, 1);
  const { courierId } = await parseBody(req, schema);

  const d = await db.query(
    `select number, status from deliveries where id = $1 and company_id = $2 and deleted_at is null for update`,
    [id, companyId]);
  if (!d.rowCount) throw notFound("Delivery");
  if (["delivered", "cancelled"].includes(d.rows[0].status)) {
    throw badRequest("This delivery is closed.");
  }
  if (courierId) {
    const m = await db.query(
      `select 1 from company_members where company_id = $1 and user_id = $2 and status = 'active'`,
      [companyId, courierId]);
    if (!m.rowCount) throw notFound("Courier");
  }
  await db.query(
    `update deliveries set courier_id = $1,
       status = case when $1 is null then 'pending' else 'assigned' end,
       assigned_at = case when $1 is null then null else now() end
     where id = $2`,
    [courierId, id]
  );
  await audit({ action: "assign", entityType: "delivery", entityId: id, entityLabel: d.rows[0].number, newValues: { courierId } });
  return { ok: true };
});
