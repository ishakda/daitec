import { PoolClient } from "pg";

/**
 * Notification engine — on-demand sweep (serverless-friendly: runs when
 * the bell is opened/polled, throttled to once per minute per company).
 *
 * Rules generate company-wide notifications (user_id null) with dedup:
 * a rule never re-fires while an UNREAD notification for the same
 * (kind, entity) exists. Once read, a persisting condition re-notifies
 * on a later sweep.
 *
 * i18n: rows store `kind` + entity label (title) + detail (body);
 * the UI renders localized text from the kind.
 */

const SWEEP_THROTTLE_SECONDS = 60;

async function notify(
  db: PoolClient, companyId: string,
  n: { kind: string; severity: string; title: string; body?: string | null; entityType?: string; entityId?: string | null }
) {
  await db.query(
    `insert into notifications (company_id, severity, kind, title, body, entity_type, entity_id)
     select $1,$2,$3,$4,$5,$6,$7
     where not exists (
       select 1 from notifications
       where company_id = $1 and kind = $3 and read_at is null
         and coalesce(entity_id, '00000000-0000-0000-0000-000000000000')
             = coalesce($7::uuid, '00000000-0000-0000-0000-000000000000')
     )`,
    [companyId, n.severity, n.kind, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null]
  );
}

export async function sweepNotifications(db: PoolClient, companyId: string): Promise<boolean> {
  // Throttle via settings row (transactional, per company).
  const throttle = await db.query(
    `insert into settings (company_id, key, value)
     values ($1, 'notif_last_sweep', to_jsonb(now()))
     on conflict (company_id, key) do update set value = to_jsonb(now())
     where settings.value::text::timestamptz < now() - make_interval(secs => $2)
     returning 1`,
    [companyId, SWEEP_THROTTLE_SECONDS]
  );
  if (!throttle.rowCount) return false; // swept recently

  // 1) Low stock / out of stock
  const lowStock = await db.query(
    `select p.id, p.name, p.minimum_stock, coalesce(sum(ib.quantity), 0) as stock
     from products p
     left join inventory_balances ib on ib.product_id = p.id
     where p.company_id = $1 and p.deleted_at is null and p.status = 'active' and p.minimum_stock > 0
     group by p.id
     having coalesce(sum(ib.quantity), 0) <= max(p.minimum_stock)
     limit 50`,
    [companyId]
  );
  for (const r of lowStock.rows) {
    const out = Number(r.stock) <= 0;
    await notify(db, companyId, {
      kind: out ? "out_of_stock" : "low_stock",
      severity: out ? "critical" : "warning",
      title: r.name,
      body: `${Number(r.stock)}/${Number(r.minimum_stock)}`,
      entityType: "product", entityId: r.id,
    });
  }

  // 2) Overdue customer invoices
  const overdue = await db.query(
    `select s.id, s.number, s.due_date, (s.total - s.paid_amount) as due, c.name as customer_name
     from sales s left join customers c on c.id = s.customer_id
     where s.company_id = $1 and s.deleted_at is null and s.status = 'completed'
       and s.sale_type in ('invoice','pos') and s.payment_status in ('unpaid','partial')
       and s.due_date < current_date
     limit 50`,
    [companyId]
  );
  for (const r of overdue.rows) {
    await notify(db, companyId, {
      kind: "overdue_customer", severity: "warning",
      title: `${r.number}${r.customer_name ? ` — ${r.customer_name}` : ""}`,
      body: String(r.due),
      entityType: "sale", entityId: r.id,
    });
  }

  // 3) Supplier invoices due within 7 days (or overdue)
  const supplierDue = await db.query(
    `select si.id, si.number, si.due_date, (si.total - si.paid_amount) as due, sp.name as supplier_name
     from supplier_invoices si join suppliers sp on sp.id = si.supplier_id
     where si.company_id = $1 and si.deleted_at is null
       and si.payment_status in ('unpaid','partial')
       and si.due_date <= current_date + 7
     limit 50`,
    [companyId]
  );
  for (const r of supplierDue.rows) {
    await notify(db, companyId, {
      kind: "supplier_due",
      severity: new Date(r.due_date) < new Date() ? "warning" : "info",
      title: `${r.number} — ${r.supplier_name}`,
      body: String(r.due),
      entityType: "supplier_invoice", entityId: r.id,
    });
  }

  // 4) Failed deliveries (last 7 days)
  const failed = await db.query(
    `select d.id, d.number, d.failure_reason, c.name as customer_name
     from deliveries d left join customers c on c.id = d.customer_id
     where d.company_id = $1 and d.deleted_at is null and d.status = 'failed'
       and d.updated_at > now() - interval '7 days'
     limit 50`,
    [companyId]
  );
  for (const r of failed.rows) {
    await notify(db, companyId, {
      kind: "delivery_failed", severity: "critical",
      title: `${r.number}${r.customer_name ? ` — ${r.customer_name}` : ""}`,
      body: r.failure_reason,
      entityType: "delivery", entityId: r.id,
    });
  }

  return true;
}
