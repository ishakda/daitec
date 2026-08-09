import { withApi, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("inventory.view");
  const { page, limit, offset } = getPagination(req, 50);
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId") || null;
  const warehouseId = url.searchParams.get("warehouseId") || null;
  const type = url.searchParams.get("type") || null;

  const rows = await db.query(
    `select m.id, m.movement_type, m.quantity, m.unit_cost, m.reference_type, m.reference_id,
            m.notes, m.created_at, p.name as product_name, p.sku, w.name as warehouse_name,
            u.full_name as created_by_name
     from stock_movements m
     join products p on p.id = m.product_id
     join warehouses w on w.id = m.warehouse_id
     left join users u on u.id = m.created_by
     where m.company_id = $1
       and ($2::uuid is null or m.product_id = $2)
       and ($3::uuid is null or m.warehouse_id = $3)
       and ($4::text is null or m.movement_type = $4)
     order by m.created_at desc limit ${limit} offset ${offset}`,
    [companyId, productId, warehouseId, type]
  );
  return { data: rows.rows, page, limit };
});
