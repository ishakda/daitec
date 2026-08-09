import { withApi } from "@/lib/api";

/** Stock valuation, low stock, out of stock, dead stock (no sales in 60 days). */
export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("reports.view");
  const showCost = await can("inventory.view_cost");
  const kind = new URL(req.url).searchParams.get("kind") ?? "valuation";

  if (kind === "low_stock") {
    const rows = await db.query(
      `select p.id, p.sku, p.name, p.minimum_stock, p.reorder_quantity,
              coalesce(sum(ib.quantity),0) as quantity
       from products p left join inventory_balances ib on ib.product_id = p.id
       where p.company_id = $1 and p.deleted_at is null and p.minimum_stock > 0
       group by p.id having coalesce(sum(ib.quantity),0) <= max(p.minimum_stock)
       order by coalesce(sum(ib.quantity),0) / nullif(max(p.minimum_stock),0)`,
      [companyId]
    );
    return { data: rows.rows, kind };
  }
  if (kind === "out_of_stock") {
    const rows = await db.query(
      `select p.id, p.sku, p.name, p.reorder_quantity
       from products p
       where p.company_id = $1 and p.deleted_at is null and p.status = 'active'
         and coalesce((select sum(quantity) from inventory_balances ib where ib.product_id = p.id),0) <= 0
       order by p.name`,
      [companyId]
    );
    return { data: rows.rows, kind };
  }
  if (kind === "dead_stock") {
    const rows = await db.query(
      `select p.id, p.sku, p.name, coalesce(sum(ib.quantity),0) as quantity
              ${showCost ? ", coalesce(sum(ib.quantity * ib.avg_cost),0) as value" : ""}
       from products p join inventory_balances ib on ib.product_id = p.id
       where p.company_id = $1 and p.deleted_at is null
         and not exists (
           select 1 from sale_items si join sales s on s.id = si.sale_id
           where si.product_id = p.id and s.sale_date >= current_date - 60
             and s.status = 'completed' and s.deleted_at is null
         )
       group by p.id having coalesce(sum(ib.quantity),0) > 0
       order by 4 desc nulls last limit 200`,
      [companyId]
    );
    return { data: rows.rows, kind };
  }
  // valuation
  const rows = await db.query(
    `select p.id, p.sku, p.name, coalesce(sum(ib.quantity),0) as quantity
            ${showCost ? ", max(ib.avg_cost) as avg_cost, coalesce(sum(ib.quantity * ib.avg_cost),0) as value" : ""}
     from products p left join inventory_balances ib on ib.product_id = p.id
     where p.company_id = $1 and p.deleted_at is null
     group by p.id order by ${showCost ? "value desc" : "quantity desc"} limit 500`,
    [companyId]
  );
  const total = showCost
    ? await db.query(
        `select coalesce(sum(quantity * avg_cost),0) as total_value from inventory_balances where company_id = $1`,
        [companyId])
    : null;
  return { data: rows.rows, kind, totalValue: total?.rows[0]?.total_value ?? null };
});
