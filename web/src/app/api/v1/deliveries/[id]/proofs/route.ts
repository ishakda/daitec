import { withApi, pathId, notFound } from "@/lib/api";

/** Proofs for a delivery (photo/signature). Courier-restricted like the detail. */
export const GET = withApi(async ({ req, db, companyId, session, can, require }) => {
  await require("deliveries.view");
  const id = pathId(req, 1);
  const d = await db.query(
    `select courier_id from deliveries where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]);
  if (!d.rowCount) throw notFound("Delivery");
  if (!(await can("deliveries.assign")) && d.rows[0].courier_id !== session.userId) throw notFound("Delivery");

  const proofs = await db.query(
    `select p.id, p.kind, p.data, p.created_at, u.full_name as created_by_name
     from delivery_proofs p left join users u on u.id = p.created_by
     where p.delivery_id = $1 and p.company_id = $2
     order by p.created_at`,
    [id, companyId]);
  return { data: proofs.rows };
});
