import { withApi, pathId, notFound } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("purchases.view");
  const id = pathId(req);
  const po = await db.query(
    `select po.*, s.name as supplier_name, w.name as warehouse_name, u.full_name as created_by_name
     from purchase_orders po
     join suppliers s on s.id = po.supplier_id
     left join warehouses w on w.id = po.warehouse_id
     left join users u on u.id = po.created_by
     where po.id = $1 and po.company_id = $2 and po.deleted_at is null`,
    [id, companyId]
  );
  if (!po.rowCount) throw notFound("Purchase order");
  const [items, receipts] = await Promise.all([
    db.query(`select * from purchase_order_items where purchase_order_id = $1 order by position`, [id]),
    db.query(
      `select id, number, receipt_date, status from goods_receipts
       where purchase_order_id = $1 and deleted_at is null order by created_at`,
      [id]
    ),
  ]);
  return { ...po.rows[0], items: items.rows, receipts: receipts.rows };
});
