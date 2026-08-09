import { z } from "zod";
import { withApi, parseBody, pathId, notFound } from "@/lib/api";

const patchSchema = z.object({
  categoryId: z.string().uuid().nullish(),
  amount: z.number().positive().optional(),
  expenseDate: z.string().nullish(),
  description: z.string().min(1).max(500).optional(),
});

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("expenses.edit");
  const id = pathId(req);
  const body = await parseBody(req, patchSchema);
  const existing = await db.query(
    `select * from expenses where id = $1 and company_id = $2 and deleted_at is null`, [id, companyId]);
  if (!existing.rowCount) throw notFound("Expense");
  const cols: Record<string, string> = { categoryId: "category_id", amount: "amount", expenseDate: "expense_date", description: "description" };
  const keys = Object.keys(cols).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (keys.length) {
    await db.query(
      `update expenses set ${keys.map((k, i) => `${cols[k]} = $${i + 1}`).join(", ")}
       where id = $${keys.length + 1} and company_id = $${keys.length + 2}`,
      [...keys.map((k) => (body as Record<string, unknown>)[k]), id, companyId]
    );
  }
  await audit({ action: "update", entityType: "expense", entityId: id, entityLabel: existing.rows[0].number, oldValues: { amount: existing.rows[0].amount }, newValues: body });
  return { ok: true };
});

export const DELETE = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("expenses.delete");
  const id = pathId(req);
  const existing = await db.query(
    `select number, amount from expenses where id = $1 and company_id = $2 and deleted_at is null`, [id, companyId]);
  if (!existing.rowCount) throw notFound("Expense");
  await db.query(`update expenses set deleted_at = now() where id = $1 and company_id = $2`, [id, companyId]);
  await audit({ action: "delete", entityType: "expense", entityId: id, entityLabel: existing.rows[0].number, oldValues: existing.rows[0] });
  return { ok: true };
});
