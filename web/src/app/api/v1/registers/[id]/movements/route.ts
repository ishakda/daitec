import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";

const schema = z.object({
  direction: z.enum(["in", "out"]),
  amount: z.number().positive(),
  reason: z.string().min(1).max(300),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("pos.use");
  const id = pathId(req, 1);
  const body = await parseBody(req, schema);
  const rs = await db.query(
    `select status from register_sessions where id = $1 and company_id = $2`,
    [id, companyId]
  );
  if (!rs.rowCount) throw notFound("Register session");
  if (rs.rows[0].status !== "open") {
    throw new ApiError(409, "SESSION_CLOSED", "This register session is closed.");
  }
  const r = await db.query(
    `insert into register_movements (company_id, register_session_id, direction, amount, reason, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [companyId, id, body.direction, body.amount, body.reason, session.userId]
  );
  await audit({
    action: "cash_movement", entityType: "register_session", entityId: id,
    newValues: body,
  });
  return { id: r.rows[0].id };
});

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("pos.use");
  const id = pathId(req, 1);
  const rows = await db.query(
    `select rm.*, u.full_name as created_by_name
     from register_movements rm left join users u on u.id = rm.created_by
     where rm.register_session_id = $1 and rm.company_id = $2 order by rm.created_at desc`,
    [id, companyId]
  );
  return { data: rows.rows };
});
