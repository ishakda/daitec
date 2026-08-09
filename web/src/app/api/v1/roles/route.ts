import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";

export const GET = withApi(async ({ db, companyId, require }) => {
  await require("users.manage");
  const roles = await db.query(
    `select r.id, r.name, r.description, r.is_system,
            coalesce((select array_agg(permission_code) from role_permissions rp where rp.role_id = r.id),'{}') as permissions,
            (select count(*)::int from company_members m where m.role_id = r.id) as member_count
     from roles r where r.company_id = $1 order by r.created_at`,
    [companyId]
  );
  const permissions = await db.query(`select code, module, description from permissions order by module, code`);
  return { data: roles.rows, catalog: permissions.rows };
});

const schema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).nullish(),
  permissions: z.array(z.string()).default([]),
});

export const POST = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("users.manage");
  const body = await parseBody(req, schema);
  const r = await db.query(
    `insert into roles (company_id, name, description) values ($1,$2,$3) returning id`,
    [companyId, body.name, body.description ?? null]
  );
  for (const code of body.permissions) {
    await db.query(
      `insert into role_permissions (role_id, permission_code) values ($1,$2) on conflict do nothing`,
      [r.rows[0].id, code]
    );
  }
  await audit({ action: "create", entityType: "role", entityId: r.rows[0].id, entityLabel: body.name, newValues: body });
  return { id: r.rows[0].id };
});
