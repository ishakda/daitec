import { withPlatformAdmin } from "@/lib/adminApi";
import { adminPool } from "@/lib/db";

/** Platform-wide metrics (privileged pool — cross-tenant by design). */
export const GET = withPlatformAdmin(async () => {
  const [companies, users, sales, topCompanies] = await Promise.all([
    adminPool.query(
      `select count(*)::int as total,
              count(*) filter (where suspended_at is not null)::int as suspended,
              count(*) filter (where created_at > now() - interval '30 days')::int as new_30d
       from companies where deleted_at is null`),
    adminPool.query(
      `select count(*)::int as total,
              count(*) filter (where created_at > now() - interval '30 days')::int as new_30d
       from users where is_active`),
    adminPool.query(
      `select count(*) filter (where sale_date = current_date)::int as sales_today,
              coalesce(sum(total) filter (where sale_date = current_date), 0) as revenue_today,
              count(*) filter (where sale_date > current_date - 30)::int as sales_30d,
              coalesce(sum(total) filter (where sale_date > current_date - 30), 0) as revenue_30d
       from sales where sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null`),
    adminPool.query(
      `select c.id, c.name, coalesce(sum(s.total), 0) as revenue_30d, count(s.id)::int as sales_30d
       from companies c
       left join sales s on s.company_id = c.id and s.sale_date > current_date - 30
         and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null
       where c.deleted_at is null
       group by c.id order by revenue_30d desc limit 5`),
  ]);
  return {
    companies: companies.rows[0],
    users: users.rows[0],
    sales: sales.rows[0],
    topCompanies: topCompanies.rows,
  };
});
