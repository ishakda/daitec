import { withApi, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("inventory.view");
  const { page, limit, offset } = getPagination(req, 50);
  const url = new URL(req.url);
  const warehouseId = url.searchParams.get("warehouseId") || null;
  const q = url.searchParams.get("q")?.trim();
  const lowStock = url.searchParams.get("lowStock") === "true";
  const showCost = await can("inventory.view_cost");

  const params: unknown[] = [companyId, warehouseId];
  let where = `p.company_id = $1 and p.deleted_at is null and ($2::uuid is null or ib.warehouse_id = $2)`;
  if (q) { params.push(`%${q}%`); where += ` and (p.name ilike $${params.length} or p.sku ilike $${params.length})`; }
  if (lowStock) where += ` and p.minimum_stock > 0`;

  const having = lowStock ? `having coalesce(sum(ib.quantity),0) <= max(p.minimum_stock)` : "";
  const rows = await db.query(
    `select p.id as product_id, p.sku, p.name, p.minimum_stock, p.selling_price,
            coalesce(sum(ib.quantity),0) as quantity
            ${showCost ? ", coalesce(sum(ib.quantity * ib.avg_cost),0) as stock_value" : ""}
     from products p
     left join inventory_balances ib on ib.product_id = p.id and ($2::uuid is null or ib.warehouse_id = $2)
     where ${where}
     group by p.id ${having}
     order by p.name limit ${limit} offset ${offset}`,
    params
  );
  const totals = showCost
    ? await db.query(
        `select coalesce(sum(ib.quantity * ib.avg_cost),0) as total_value
         from inventory_balances ib where ib.company_id = $1 and ($2::uuid is null or ib.warehouse_id = $2)`,
        [companyId, warehouseId]
      )
    : null;
  return { data: rows.rows, page, limit, totalValue: totals?.rows[0]?.total_value ?? null };
});
