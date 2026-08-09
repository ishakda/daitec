import { PoolClient } from "pg";
import { badRequest, notFound, ApiError } from "../api";

/** Manual stock adjustment — always goes through the ledger. */
export async function adjustStock(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: {
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    kind: "adjustment_in" | "adjustment_out" | "damage" | "loss" | "initial" | "count";
    quantity: number; // positive; direction derived from kind (count = absolute target)
    unitCost?: number | null;
    notes?: string | null;
  }
) {
  if (input.quantity < 0) throw badRequest("Quantity must be positive.");

  const bal = await db.query(
    `select quantity, avg_cost from inventory_balances
     where warehouse_id = $1 and product_id = $2
       and coalesce(variant_id,'00000000-0000-0000-0000-000000000000') = coalesce($3::uuid,'00000000-0000-0000-0000-000000000000')`,
    [input.warehouseId, input.productId, input.variantId ?? null]
  );
  const currentQty = Number(bal.rows[0]?.quantity ?? 0);
  const avgCost = Number(bal.rows[0]?.avg_cost ?? 0);

  let signedQty: number;
  if (input.kind === "count") {
    signedQty = input.quantity - currentQty; // set absolute counted quantity
    if (signedQty === 0) return { movementId: null, delta: 0 };
  } else if (["adjustment_out", "damage", "loss"].includes(input.kind)) {
    if (input.quantity === 0) throw badRequest("Quantity must be positive.");
    signedQty = -input.quantity;
  } else {
    if (input.quantity === 0) throw badRequest("Quantity must be positive.");
    signedQty = input.quantity;
  }

  const unitCost = input.unitCost ?? (signedQty > 0 && input.kind === "initial" ? 0 : avgCost);
  const mv = await db.query(
    `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
        movement_type, quantity, unit_cost, reference_type, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,'adjustment',$8,$9) returning id`,
    [companyId, input.warehouseId, input.productId, input.variantId ?? null,
     input.kind, signedQty, unitCost, input.notes ?? null, userId]
  );
  return { movementId: mv.rows[0].id, delta: signedQty };
}

/** Create a transfer (draft), send it (stock leaves), receive it (stock arrives). */
export async function createTransfer(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
    notes?: string | null;
  }
) {
  if (input.fromWarehouseId === input.toWarehouseId)
    throw badRequest("Source and destination warehouses must differ.");
  if (!input.items.length) throw badRequest("A transfer needs at least one item.");

  const num = await db.query(`select next_document_number($1,'transfer') as n`, [companyId]);
  const tr = await db.query(
    `insert into stock_transfers (company_id, number, from_warehouse_id, to_warehouse_id, notes, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, number`,
    [companyId, num.rows[0].n, input.fromWarehouseId, input.toWarehouseId, input.notes ?? null, userId]
  );
  for (const item of input.items) {
    if (item.quantity <= 0) throw badRequest("Transfer quantities must be positive.");
    await db.query(
      `insert into stock_transfer_items (company_id, transfer_id, product_id, variant_id, quantity)
       values ($1,$2,$3,$4,$5)`,
      [companyId, tr.rows[0].id, item.productId, item.variantId ?? null, item.quantity]
    );
  }
  return { transferId: tr.rows[0].id, number: tr.rows[0].number };
}

export async function sendTransfer(db: PoolClient, companyId: string, userId: string, transferId: string) {
  const tr = await db.query(
    `select * from stock_transfers where id = $1 and company_id = $2 for update`,
    [transferId, companyId]
  );
  if (!tr.rowCount) throw notFound("Transfer");
  if (tr.rows[0].status !== "draft")
    throw new ApiError(409, "INVALID_STATUS", "Only draft transfers can be sent.");

  const items = await db.query(
    `select * from stock_transfer_items where transfer_id = $1`, [transferId]
  );
  for (const item of items.rows) {
    const bal = await db.query(
      `select avg_cost from inventory_balances
       where warehouse_id = $1 and product_id = $2
         and coalesce(variant_id,'00000000-0000-0000-0000-000000000000') = coalesce($3::uuid,'00000000-0000-0000-0000-000000000000')`,
      [tr.rows[0].from_warehouse_id, item.product_id, item.variant_id]
    );
    const cost = Number(bal.rows[0]?.avg_cost ?? 0);
    await db.query(
      `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
          movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
       values ($1,$2,$3,$4,'transfer_out',$5,$6,'stock_transfer',$7,$8)`,
      [companyId, tr.rows[0].from_warehouse_id, item.product_id, item.variant_id,
       -Number(item.quantity), cost, transferId, userId]
    );
  }
  await db.query(
    `update stock_transfers set status = 'in_transit', sent_at = now() where id = $1`,
    [transferId]
  );
  return { status: "in_transit" };
}

export async function receiveTransfer(db: PoolClient, companyId: string, userId: string, transferId: string) {
  const tr = await db.query(
    `select * from stock_transfers where id = $1 and company_id = $2 for update`,
    [transferId, companyId]
  );
  if (!tr.rowCount) throw notFound("Transfer");
  if (tr.rows[0].status !== "in_transit")
    throw new ApiError(409, "INVALID_STATUS", "Only in-transit transfers can be received.");

  const items = await db.query(
    `select ti.*, (
       select sm.unit_cost from stock_movements sm
       where sm.reference_type = 'stock_transfer' and sm.reference_id = $1
         and sm.product_id = ti.product_id and sm.movement_type = 'transfer_out'
         and coalesce(sm.variant_id,'00000000-0000-0000-0000-000000000000') = coalesce(ti.variant_id,'00000000-0000-0000-0000-000000000000')
       order by sm.created_at desc limit 1
     ) as out_cost
     from stock_transfer_items ti where ti.transfer_id = $1`,
    [transferId]
  );
  for (const item of items.rows) {
    await db.query(
      `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
          movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
       values ($1,$2,$3,$4,'transfer_in',$5,$6,'stock_transfer',$7,$8)`,
      [companyId, tr.rows[0].to_warehouse_id, item.product_id, item.variant_id,
       Number(item.quantity), Number(item.out_cost ?? 0), transferId, userId]
    );
  }
  await db.query(
    `update stock_transfers set status = 'received', received_at = now() where id = $1`,
    [transferId]
  );
  return { status: "received" };
}
