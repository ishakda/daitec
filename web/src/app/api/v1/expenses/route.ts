import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("expenses.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId") || null;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const params: unknown[] = [companyId, categoryId];
  let where = `e.company_id = $1 and e.deleted_at is null and ($2::uuid is null or e.category_id = $2)`;
  if (from) { params.push(from); where += ` and e.expense_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` and e.expense_date <= $${params.length}`; }

  const count = await db.query(
    `select count(*)::int as total, coalesce(sum(e.amount),0) as sum from expenses e where ${where}`, params);
  const rows = await db.query(
    `select e.id, e.number, e.amount, e.expense_date, e.description, e.attachment_url,
            c.name as category_name, m.name as method_name, u.full_name as created_by_name
     from expenses e
     left join expense_categories c on c.id = e.category_id
     left join payment_methods m on m.id = e.payment_method_id
     left join users u on u.id = e.created_by
     where ${where}
     order by e.expense_date desc, e.created_at desc limit ${limit} offset ${offset}`,
    params
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total, sum: count.rows[0].sum };
});

const schema = z.object({
  categoryId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  paymentMethodId: z.string().uuid().nullish(),
  registerSessionId: z.string().uuid().nullish(),
  employeeId: z.string().uuid().nullish(),
  amount: z.number().positive(),
  expenseDate: z.string().nullish(),
  description: z.string().min(1).max(500),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("expenses.create");
  const body = await parseBody(req, schema);
  const num = await db.query(`select next_document_number($1,'expense') as n`, [companyId]);
  const r = await db.query(
    `insert into expenses (company_id, number, category_id, branch_id, payment_method_id,
        register_session_id, employee_id, amount, expense_date, description, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::date,current_date),$10,$11) returning id, number`,
    [companyId, num.rows[0].n, body.categoryId ?? null, body.branchId ?? null,
     body.paymentMethodId ?? null, body.registerSessionId ?? null, body.employeeId ?? null,
     body.amount, body.expenseDate ?? null, body.description, session.userId]
  );
  await audit({
    action: "create", entityType: "expense", entityId: r.rows[0].id,
    entityLabel: r.rows[0].number, newValues: body,
  });
  return { id: r.rows[0].id, number: r.rows[0].number };
});
