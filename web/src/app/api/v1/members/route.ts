import { z } from "zod";
import { withApi, withAuthOnly, parseBody, badRequest } from "@/lib/api";
import { adminPool } from "@/lib/db";
import { hashPassword, getActiveCompanyId } from "@/lib/auth";

export const GET = withApi(async ({ db, companyId, require }) => {
  await require("users.manage");
  const rows = await db.query(
    `select m.id, m.user_id, m.is_owner, m.status, u.full_name, u.email, u.phone,
            r.id as role_id, r.name as role_name, m.created_at
     from company_members m
     join users u on u.id = m.user_id
     join roles r on r.id = m.role_id
     where m.company_id = $1 order by u.full_name`,
    [companyId]
  );
  return { data: rows.rows };
});

const schema = z.object({
  email: z.string().email().toLowerCase(),
  fullName: z.string().min(2).max(120),
  password: z.string().min(8),
  roleId: z.string().uuid(),
});

/**
 * Add an employee account to the active company. Runs on the privileged
 * pool (creates users), but authorization is checked against the caller's
 * membership + users.manage permission first.
 */
export const POST = withAuthOnly(async ({ req, session }) => {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw badRequest("No active company.");
  const body = await parseBody(req, schema);

  const authz = await adminPool.query(
    `select 1 from company_members m
     where m.company_id = $1 and m.user_id = $2 and m.status = 'active'
       and (m.is_owner or exists (
         select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_code = 'users.manage'))`,
    [companyId, session.userId]
  );
  if (!authz.rowCount) throw badRequest("You cannot manage users in this company.");

  const role = await adminPool.query(
    `select 1 from roles where id = $1 and company_id = $2`, [body.roleId, companyId]);
  if (!role.rowCount) throw badRequest("Invalid role for this company.");

  const client = await adminPool.connect();
  try {
    await client.query("begin");
    let userId: string;
    const existing = await client.query(`select id from users where email = $1`, [body.email]);
    if (existing.rowCount) {
      userId = existing.rows[0].id;
    } else {
      const u = await client.query(
        `insert into users (email, full_name) values ($1,$2) returning id`,
        [body.email, body.fullName]
      );
      userId = u.rows[0].id;
      await client.query(
        `insert into auth_credentials (user_id, password_hash) values ($1,$2)`,
        [userId, await hashPassword(body.password)]
      );
    }
    await client.query(
      `insert into company_members (company_id, user_id, role_id) values ($1,$2,$3)
       on conflict (company_id, user_id) do update set role_id = $3, status = 'active'`,
      [companyId, userId, body.roleId]
    );
    await client.query(
      `insert into audit_logs (company_id, user_id, action, entity_type, entity_id, entity_label, new_values)
       values ($1,$2,'create','member',$3,$4,$5)`,
      [companyId, session.userId, userId, body.fullName, JSON.stringify({ email: body.email, roleId: body.roleId })]
    );
    await client.query("commit");
    return { userId };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
