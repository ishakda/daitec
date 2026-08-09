import { withPlatformAdmin } from "@/lib/adminApi";
import { adminPool } from "@/lib/db";

/** All companies with operational stats. */
export const GET = withPlatformAdmin(async ({ req }) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const rows = await adminPool.query(
    `select c.id, c.name, c.city, c.wilaya, c.activity, c.created_at,
            c.suspended_at, c.suspension_reason,
            (select u.email from company_members m join users u on u.id = m.user_id
             where m.company_id = c.id and m.is_owner limit 1) as owner_email,
            (select count(*)::int from company_members m where m.company_id = c.id and m.status = 'active') as members,
            (select count(*)::int from products p where p.company_id = c.id and p.deleted_at is null) as products,
            (select count(*)::int from sales s where s.company_id = c.id and s.sale_date > current_date - 30
              and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null) as sales_30d,
            (select coalesce(sum(s.total),0) from sales s where s.company_id = c.id and s.sale_date > current_date - 30
              and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null) as revenue_30d,
            (select max(a.created_at) from audit_logs a where a.company_id = c.id) as last_activity
     from companies c
     where c.deleted_at is null and ($1::text is null or c.name ilike '%' || $1 || '%')
     order by c.created_at desc limit 200`,
    [q || null]
  );
  return { data: rows.rows };
});
