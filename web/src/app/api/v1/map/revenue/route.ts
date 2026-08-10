import { withApi } from "@/lib/api";

/**
 * Revenue by customer location — powers the sales heatmap.
 * Sums completed invoice/POS sales (returns subtracted) per geolocated
 * customer over a rolling window. Walk-in POS sales (no customer_id) have
 * no location and are excluded by design.
 */
export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("map.view");
  const url = new URL(req.url);
  const rawDays = Number(url.searchParams.get("days"));
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 3650) : 90;

  const { rows } = await db.query(
    `select c.id, c.name, c.latitude, c.longitude,
            coalesce(sum(
              case when s.sale_type = 'return' then -s.total else s.total end
            ), 0) as revenue,
            count(*) filter (where s.sale_type <> 'return') as orders
     from customers c
     join sales s
       on s.customer_id = c.id
      and s.company_id = c.company_id
      and s.status = 'completed'
      and s.sale_type in ('invoice','pos','return')
      and s.sale_date >= (current_date - ($2 || ' days')::interval)
     where c.company_id = $1
       and c.deleted_at is null
       and c.latitude is not null
       and c.longitude is not null
     group by c.id, c.name, c.latitude, c.longitude
     having coalesce(sum(
              case when s.sale_type = 'return' then -s.total else s.total end
            ), 0) > 0
     order by revenue desc
     limit 2000`,
    [companyId, String(days)]
  );

  const points = rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    revenue: Number(r.revenue),
    orders: Number(r.orders),
  }));
  const maxRevenue = points.reduce((m, p) => Math.max(m, p.revenue), 0);
  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);

  return { days, points, maxRevenue, totalRevenue };
});
