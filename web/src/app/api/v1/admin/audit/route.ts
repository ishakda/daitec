import { withPlatformAdmin } from "@/lib/adminApi";
import { adminPool } from "@/lib/db";

export const GET = withPlatformAdmin(async () => {
  const rows = await adminPool.query(
    `select a.id, a.action, a.company_id, a.details, a.created_at,
            u.full_name as admin_name, u.email as admin_email,
            c.name as company_name
     from platform_audit_logs a
     join users u on u.id = a.admin_user_id
     left join companies c on c.id = a.company_id
     order by a.created_at desc limit 100`);
  return { data: rows.rows };
});
