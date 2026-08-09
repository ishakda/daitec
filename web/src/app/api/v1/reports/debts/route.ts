import { withApi } from "@/lib/api";

/** Receivables & payables aging. */
export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("reports.view");
  const side = new URL(req.url).searchParams.get("side") ?? "customers";

  if (side === "suppliers") {
    await require("suppliers.view_debt");
    const rows = await db.query(
      `select s.id, s.name, s.phone, s.balance,
         (select count(*)::int from supplier_invoices si
          where si.supplier_id = s.id and si.payment_status in ('unpaid','partial')
            and si.due_date < current_date and si.deleted_at is null) as overdue_invoices,
         (select min(due_date) from supplier_invoices si
          where si.supplier_id = s.id and si.payment_status in ('unpaid','partial') and si.deleted_at is null) as next_due
       from suppliers s
       where s.company_id = $1 and s.balance > 0 and s.deleted_at is null
       order by s.balance desc`,
      [companyId]
    );
    const totals = await db.query(
      `select coalesce(sum(balance),0) as total from suppliers where company_id = $1 and balance > 0 and deleted_at is null`,
      [companyId]
    );
    return { data: rows.rows, total: totals.rows[0].total, side };
  }

  await require("customers.view_debt");
  const rows = await db.query(
    `select c.id, c.name, c.phone, c.balance, c.credit_limit,
       (select count(*)::int from sales s
        where s.customer_id = c.id and s.payment_status in ('unpaid','partial')
          and s.due_date < current_date and s.deleted_at is null) as overdue_invoices,
       (select min(due_date) from sales s
        where s.customer_id = c.id and s.payment_status in ('unpaid','partial') and s.deleted_at is null) as next_due
     from customers c
     where c.company_id = $1 and c.balance > 0 and c.deleted_at is null
     order by c.balance desc`,
    [companyId]
  );
  const totals = await db.query(
    `select coalesce(sum(balance),0) as total,
       coalesce((select sum(s.total - s.paid_amount) from sales s
                 where s.company_id = $1 and s.payment_status in ('unpaid','partial')
                   and s.due_date < current_date and s.sale_type in ('invoice','pos')
                   and s.status = 'completed' and s.deleted_at is null),0) as overdue
     from customers where company_id = $1 and balance > 0 and deleted_at is null`,
    [companyId]
  );
  return { data: rows.rows, total: totals.rows[0].total, overdue: totals.rows[0].overdue, side };
});
