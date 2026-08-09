import { withApi, badRequest } from "@/lib/api";

/**
 * Sales report with grouping: day | month | product | category | employee | method.
 * Optional CSV export via ?format=csv (requires reports.export).
 */
export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("reports.view");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const groupBy = url.searchParams.get("groupBy") ?? "day";
  const format = url.searchParams.get("format");
  const showProfit = await can("sales.view_profit");

  const profitCols = showProfit
    ? `, coalesce(sum(s.total_cost),0) as cogs, coalesce(sum(s.total - s.tax_amount - s.total_cost),0) as gross_profit`
    : "";

  let sql: string;
  const params: unknown[] = [companyId, from, to];
  const base = `from sales s
     where s.company_id = $1 and s.sale_date between $2 and $3
       and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null`;

  switch (groupBy) {
    case "day":
      sql = `select s.sale_date::text as label, count(*)::int as sales_count,
               coalesce(sum(s.total),0) as revenue ${profitCols} ${base}
             group by s.sale_date order by s.sale_date`;
      break;
    case "month":
      sql = `select to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as label,
               count(*)::int as sales_count, coalesce(sum(s.total),0) as revenue ${profitCols} ${base}
             group by 1 order by 1`;
      break;
    case "employee":
      sql = `select coalesce(u.full_name,'—') as label, count(*)::int as sales_count,
               coalesce(sum(s.total),0) as revenue ${profitCols} ${base.replace("from sales s", "from sales s left join users u on u.id = s.created_by")}
             group by 1 order by revenue desc`;
      break;
    case "method":
      sql = `select m.name as label, count(distinct s.id)::int as sales_count,
               coalesce(sum(pa.amount),0) as revenue
             from payment_allocations pa
             join payments p on p.id = pa.payment_id and p.deleted_at is null
             join payment_methods m on m.id = p.payment_method_id
             join sales s on s.id = pa.target_id and pa.target_type = 'sale'
             where s.company_id = $1 and s.sale_date between $2 and $3
               and s.deleted_at is null
             group by m.name order by revenue desc`;
      break;
    case "product": {
      const costCols = showProfit
        ? `, coalesce(sum(si.unit_cost * si.quantity),0) as cogs,
           coalesce(sum(si.line_total - (si.line_total * si.tax_rate / (100 + si.tax_rate)) - si.unit_cost * si.quantity),0) as gross_profit`
        : "";
      sql = `select si.description as label, coalesce(sum(si.quantity),0) as quantity,
               coalesce(sum(si.line_total),0) as revenue ${costCols}
             from sale_items si join sales s on s.id = si.sale_id
             where s.company_id = $1 and s.sale_date between $2 and $3
               and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null
             group by si.description order by revenue desc limit 100`;
      break;
    }
    case "category":
      sql = `select coalesce(c.name,'Sans catégorie') as label, coalesce(sum(si.quantity),0) as quantity,
               coalesce(sum(si.line_total),0) as revenue
             from sale_items si
             join sales s on s.id = si.sale_id
             left join products p on p.id = si.product_id
             left join product_categories c on c.id = p.category_id
             where s.company_id = $1 and s.sale_date between $2 and $3
               and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null
             group by 1 order by revenue desc`;
      break;
    default:
      throw badRequest("Invalid groupBy.");
  }

  const rows = await db.query(sql, params);

  if (format === "csv") {
    await require("reports.export");
    const cols = rows.rows.length ? Object.keys(rows.rows[0]) : ["label"];
    const csv = [
      cols.join(","),
      ...rows.rows.map((r) => cols.map((c) => JSON.stringify(String(r[c] ?? ""))).join(",")),
    ].join("\n");
    const { NextResponse } = await import("next/server");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sales-${groupBy}-${from}-${to}.csv"`,
      },
    });
  }
  return { data: rows.rows, from, to, groupBy };
});
