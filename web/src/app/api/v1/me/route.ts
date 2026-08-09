import { withAuthOnly } from "@/lib/api";
import { adminPool } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/auth";

export const GET = withAuthOnly(async ({ session }) => {
  const isAdmin = await adminPool.query(
    `select 1 from platform_admins where user_id = $1`, [session.userId]);
  const memberships = await adminPool.query(
    `select m.company_id, c.name as company_name, c.currency, c.suspended_at, m.is_owner, r.name as role_name,
            coalesce(
              (select array_agg(rp.permission_code) from role_permissions rp where rp.role_id = m.role_id),
              '{}'
            ) as permissions
     from company_members m
     join companies c on c.id = m.company_id
     join roles r on r.id = m.role_id
     where m.user_id = $1 and m.status = 'active' and c.deleted_at is null
     order by c.created_at`,
    [session.userId]
  );

  const activeCompanyId = await getActiveCompanyId();
  const active = memberships.rows.find((m) => m.company_id === activeCompanyId) ?? null;

  return {
    user: { id: session.userId, email: session.email, fullName: session.fullName },
    companies: memberships.rows.map((m) => ({
      id: m.company_id,
      name: m.company_name,
      currency: m.currency,
      role: m.role_name,
      isOwner: m.is_owner,
      suspended: m.suspended_at != null,
    })),
    activeCompanyId: active?.company_id ?? null,
    permissions: active ? (active.is_owner ? ["*"] : active.permissions) : [],
    isPlatformAdmin: (isAdmin.rowCount ?? 0) > 0,
  };
});
