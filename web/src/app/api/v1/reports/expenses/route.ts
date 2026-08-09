import { withApi } from "@/lib/api";

/** Expense breakdown by category + financial summary (P&L estimate). */
export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("reports.view");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const showProfit = await can("sales.view_profit");

  const byCategory = await db.query(
    `select coalesce(c.name,'Sans catégorie') as category, coalesce(sum(e.amount),0) as amount, count(*)::int as entries
     from expenses e left join expense_categories c on c.id = e.category_id
     where e.company_id = $1 and e.expense_date between $2 and $3 and e.deleted_at is null
     group by 1 order by amount desc`,
    [companyId, from, to]
  );

  let summary = null;
  if (showProfit) {
    const s = await db.query(
      `select
         coalesce((select sum(total) from sales where company_id = $1 and sale_date between $2 and $3
                   and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null),0) as revenue,
         coalesce((select sum(total_cost) from sales where company_id = $1 and sale_date between $2 and $3
                   and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null),0) as cogs,
         coalesce((select sum(tax_amount) from sales where company_id = $1 and sale_date between $2 and $3
                   and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null),0) as taxes_collected,
         coalesce((select sum(total) from sales where company_id = $1 and sale_date between $2 and $3
                   and sale_type = 'return' and deleted_at is null),0) as returns,
         coalesce((select sum(amount) from expenses where company_id = $1 and expense_date between $2 and $3
                   and deleted_at is null),0) as expenses`,
      [companyId, from, to]
    );
    const r = s.rows[0];
    summary = {
      ...r,
      gross_profit: Number(r.revenue) - Number(r.taxes_collected) - Number(r.cogs) - Number(r.returns),
      net_estimate: Number(r.revenue) - Number(r.taxes_collected) - Number(r.cogs) - Number(r.returns) - Number(r.expenses),
    };
  }
  return { byCategory: byCategory.rows, summary, from, to };
});
