import { withApi } from "@/lib/api";

/** The courier's own worklist (mobile page). */
export const GET = withApi(async ({ db, companyId, session, require }) => {
  await require("deliveries.view");
  const rows = await db.query(
    `select d.id, d.number, d.status, d.address, d.city, d.phone, d.latitude, d.longitude,
            d.cod_amount, d.notes, d.created_at, c.name as customer_name,
            s.number as sale_number
     from deliveries d
     left join customers c on c.id = d.customer_id
     left join sales s on s.id = d.sale_id
     where d.company_id = $1 and d.courier_id = $2 and d.deleted_at is null
       and d.status in ('assigned','picked_up','out_for_delivery')
     order by d.assigned_at asc`,
    [companyId, session.userId]
  );
  const done = await db.query(
    `select count(*)::int as delivered_today,
            coalesce(sum(cod_amount) filter (where cod_payment_id is not null), 0) as cod_today
     from deliveries
     where company_id = $1 and courier_id = $2 and status = 'delivered'
       and delivered_at::date = current_date`,
    [companyId, session.userId]
  );
  return { data: rows.rows, today: done.rows[0] };
});
