import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";
import { round2 } from "@/lib/money";

const schema = z.object({
  actualCash: z.number().min(0),
  notes: z.string().max(1000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("pos.close_register");
  const id = pathId(req, 1);
  const body = await parseBody(req, schema);

  const rs = await db.query(
    `select * from register_sessions where id = $1 and company_id = $2 for update`,
    [id, companyId]
  );
  if (!rs.rowCount) throw notFound("Register session");
  if (rs.rows[0].status !== "open") {
    throw new ApiError(409, "ALREADY_CLOSED", "This register session is already closed.");
  }

  // Expected cash = opening + cash payments in − cash payments out
  // (payments linked to this session whose method kind is 'cash')
  // + manual register movements ± − cash expenses recorded on the session.
  const cashFlow = await db.query(
    `select coalesce(sum(case when p.direction = 'in' then p.amount else -p.amount end),0) as net
     from payments p join payment_methods m on m.id = p.payment_method_id
     where p.register_session_id = $1 and p.deleted_at is null and p.status = 'completed'
       and m.kind = 'cash'`,
    [id]
  );
  const movements = await db.query(
    `select coalesce(sum(case when direction = 'in' then amount else -amount end),0) as net
     from register_movements where register_session_id = $1`,
    [id]
  );
  const expenses = await db.query(
    `select coalesce(sum(e.amount),0) as total
     from expenses e left join payment_methods m on m.id = e.payment_method_id
     where e.register_session_id = $1 and e.deleted_at is null and (m.kind = 'cash' or m.kind is null)`,
    [id]
  );

  const expected = round2(
    Number(rs.rows[0].opening_cash) + Number(cashFlow.rows[0].net) +
    Number(movements.rows[0].net) - Number(expenses.rows[0].total)
  );
  const difference = round2(body.actualCash - expected);

  await db.query(
    `update register_sessions
     set status = 'closed', closed_by = $1, expected_cash = $2, actual_cash = $3,
         difference = $4, notes = coalesce($5, notes), closed_at = now()
     where id = $6`,
    [session.userId, expected, body.actualCash, difference, body.notes ?? null, id]
  );
  await audit({
    action: "close_register", entityType: "register_session", entityId: id,
    newValues: { expected, actual: body.actualCash, difference },
  });
  return { expected, actual: body.actualCash, difference };
});
