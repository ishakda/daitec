import { withApi, getPagination } from "@/lib/api";
import { sweepNotifications } from "@/lib/domain/notifications";

/**
 * Notification feed. Runs the (throttled) sweep first so opening the
 * bell always reflects current business conditions.
 */
export const GET = withApi(async ({ req, db, companyId, session }) => {
  const { limit } = getPagination(req, 30, 100);
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";

  await sweepNotifications(db, companyId);

  const rows = await db.query(
    `select id, severity, kind, title, body, entity_type, entity_id, read_at, created_at
     from notifications
     where company_id = $1 and (user_id is null or user_id = $2)
       and (not $3 or read_at is null)
     order by created_at desc limit ${limit}`,
    [companyId, session.userId, unreadOnly]
  );
  const unread = await db.query(
    `select count(*)::int as n from notifications
     where company_id = $1 and (user_id is null or user_id = $2) and read_at is null`,
    [companyId, session.userId]
  );
  return { data: rows.rows, unread: unread.rows[0].n };
});
