import { withApi, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("audit.view");
  const { page, limit, offset } = getPagination(req, 50);
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType") || null;
  const action = url.searchParams.get("action") || null;
  const userId = url.searchParams.get("userId") || null;

  const rows = await db.query(
    `select a.id, a.action, a.entity_type, a.entity_id, a.entity_label, a.old_values,
            a.new_values, a.ip, a.created_at, u.full_name as user_name, u.email as user_email
     from audit_logs a left join users u on u.id = a.user_id
     where a.company_id = $1
       and ($2::text is null or a.entity_type = $2)
       and ($3::text is null or a.action = $3)
       and ($4::uuid is null or a.user_id = $4)
     order by a.created_at desc limit ${limit} offset ${offset}`,
    [companyId, entityType, action, userId]
  );
  return { data: rows.rows, page, limit };
});
