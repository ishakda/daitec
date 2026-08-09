import { z } from "zod";
import { withApi, parseBody, ApiError } from "@/lib/api";

/** GET: current open session (if any) + recent sessions. POST: open a session. */
export const GET = withApi(async ({ db, companyId, session, require }) => {
  await require("pos.use");
  const open = await db.query(
    `select rs.*, u.full_name as opened_by_name from register_sessions rs
     join users u on u.id = rs.opened_by
     where rs.company_id = $1 and rs.status = 'open' and rs.opened_by = $2
     order by rs.opened_at desc limit 1`,
    [companyId, session.userId]
  );
  const recent = await db.query(
    `select rs.id, rs.status, rs.opening_cash, rs.expected_cash, rs.actual_cash, rs.difference,
            rs.opened_at, rs.closed_at, u.full_name as opened_by_name
     from register_sessions rs join users u on u.id = rs.opened_by
     where rs.company_id = $1 order by rs.opened_at desc limit 10`,
    [companyId]
  );
  return { current: open.rows[0] ?? null, recent: recent.rows };
});

const openSchema = z.object({
  branchId: z.string().uuid().nullish(),
  openingCash: z.number().min(0).default(0),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("pos.open_register");
  const body = await parseBody(req, openSchema);
  const existing = await db.query(
    `select id from register_sessions where company_id = $1 and opened_by = $2 and status = 'open'`,
    [companyId, session.userId]
  );
  if (existing.rowCount) {
    throw new ApiError(409, "REGISTER_ALREADY_OPEN", "You already have an open register session.");
  }
  const r = await db.query(
    `insert into register_sessions (company_id, branch_id, opened_by, opening_cash)
     values ($1,$2,$3,$4) returning id, opened_at`,
    [companyId, body.branchId ?? null, session.userId, body.openingCash]
  );
  await audit({
    action: "open_register", entityType: "register_session", entityId: r.rows[0].id,
    newValues: { openingCash: body.openingCash },
  });
  return { sessionId: r.rows[0].id, openedAt: r.rows[0].opened_at };
});
