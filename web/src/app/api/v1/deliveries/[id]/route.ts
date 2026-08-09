import { withApi, pathId, notFound } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, session, can, require }) => {
  await require("deliveries.view");
  const id = pathId(req);
  const d = await db.query(
    `select d.*, c.name as customer_name, u.full_name as courier_name,
            s.number as sale_number, s.total as sale_total, s.paid_amount as sale_paid,
            cb.full_name as created_by_name
     from deliveries d
     left join customers c on c.id = d.customer_id
     left join users u on u.id = d.courier_id
     left join sales s on s.id = d.sale_id
     left join users cb on cb.id = d.created_by
     where d.id = $1 and d.company_id = $2 and d.deleted_at is null`,
    [id, companyId]
  );
  if (!d.rowCount) throw notFound("Delivery");
  const row = d.rows[0];
  // Couriers may only open their own deliveries.
  if (!(await can("deliveries.assign")) && row.courier_id !== session.userId) throw notFound("Delivery");
  return row;
});
