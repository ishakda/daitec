import { adminPool } from "./db";

/**
 * Company provisioning (privileged path, single transaction):
 * company → default roles + permissions → owner membership →
 * main branch + default warehouse → payment methods →
 * expense categories → default unit.
 */

const ALL = "__ALL__";

const DEFAULT_ROLES: Record<string, string[] | typeof ALL> = {
  Owner: ALL,
  Administrator: ALL,
  Manager: [
    "dashboard.view",
    "sales.view", "sales.create", "sales.edit", "sales.refund", "sales.discount",
    "sales.view_cost", "sales.view_profit",
    "pos.use", "pos.open_register", "pos.close_register",
    "products.view", "products.create", "products.edit", "products.view_cost",
    "inventory.view", "inventory.adjust", "inventory.transfer", "inventory.view_cost",
    "purchases.view", "purchases.create", "purchases.edit", "purchases.receive",
    "customers.view", "customers.create", "customers.edit", "customers.view_debt",
    "suppliers.view", "suppliers.create", "suppliers.edit", "suppliers.view_debt",
    "payments.view", "payments.create",
    "expenses.view", "expenses.create", "expenses.edit",
    "invoices.view", "invoices.create",
    "reports.view", "reports.export",
    "deliveries.view", "deliveries.create", "deliveries.assign",
    "deliveries.update_status", "deliveries.track", "map.view",
  ],
  Salesperson: [
    "dashboard.view",
    "sales.view", "sales.create", "sales.discount",
    "products.view",
    "customers.view", "customers.create", "customers.edit", "customers.view_debt",
    "invoices.view", "invoices.create",
    "payments.view", "payments.create",
  ],
  Cashier: [
    "pos.use", "pos.open_register", "pos.close_register",
    "sales.view", "sales.create",
    "products.view", "customers.view",
    "payments.view", "payments.create",
  ],
  "Warehouse Manager": [
    "dashboard.view",
    "products.view",
    "inventory.view", "inventory.adjust", "inventory.transfer",
    "purchases.view", "purchases.receive",
  ],
  Livreur: [
    "deliveries.view", "deliveries.update_status",
  ],
  Accountant: [
    "dashboard.view",
    "sales.view", "sales.view_cost", "sales.view_profit",
    "purchases.view",
    "customers.view", "customers.view_debt",
    "suppliers.view", "suppliers.view_debt",
    "payments.view", "payments.create",
    "expenses.view", "expenses.create", "expenses.edit",
    "invoices.view", "invoices.create",
    "reports.view", "reports.export",
    "audit.view",
  ],
};

const DEFAULT_PAYMENT_METHODS = [
  { name: "Espèces", code: "cash", kind: "cash" },
  { name: "Carte CIB", code: "cib", kind: "card" },
  { name: "Edahabia", code: "edahabia", kind: "card" },
  { name: "Virement bancaire", code: "transfer", kind: "bank" },
  { name: "Chèque", code: "cheque", kind: "cheque" },
  { name: "Crédit", code: "credit", kind: "credit" },
];

const DEFAULT_EXPENSE_CATEGORIES = [
  "Loyer", "Électricité", "Internet", "Transport", "Salaires",
  "Maintenance", "Fournitures", "Marketing", "Impôts et taxes", "Autre",
];

const DOC_SEQUENCES: Array<[string, string]> = [
  ["invoice", "FAC"], ["pos", "TCK"], ["quotation", "DEV"], ["sales_order", "BC"],
  ["delivery_note", "BL"], ["credit_note", "AV"], ["purchase_order", "CMD"],
  ["goods_receipt", "BR"], ["supplier_invoice", "FF"], ["payment", "PAY"],
  ["transfer", "TRF"], ["expense", "DEP"], ["delivery", "LIV"],
];

export async function provisionCompany(opts: {
  ownerUserId: string;
  name: string;
  legalName?: string;
  activity?: string;
  nif?: string; nis?: string; rc?: string; ai?: string;
  address?: string; city?: string; wilaya?: string; phone?: string;
  currency?: string;
  defaultTaxRate?: number;
}): Promise<{ companyId: string }> {
  const client = await adminPool.connect();
  try {
    await client.query("begin");

    const company = await client.query(
      `insert into companies (name, legal_name, activity, nif, nis, rc, ai, address, city, wilaya, phone, currency, default_tax_rate)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [
        opts.name, opts.legalName ?? null, opts.activity ?? null,
        opts.nif ?? null, opts.nis ?? null, opts.rc ?? null, opts.ai ?? null,
        opts.address ?? null, opts.city ?? null, opts.wilaya ?? null, opts.phone ?? null,
        opts.currency ?? "DZD", opts.defaultTaxRate ?? 19,
      ]
    );
    const companyId: string = company.rows[0].id;

    const { rows: allPerms } = await client.query(`select code from permissions`);
    const allCodes: string[] = allPerms.map((r) => r.code);

    let ownerRoleId: string | null = null;
    for (const [roleName, perms] of Object.entries(DEFAULT_ROLES)) {
      const role = await client.query(
        `insert into roles (company_id, name, is_system) values ($1,$2,true) returning id`,
        [companyId, roleName]
      );
      const roleId = role.rows[0].id;
      if (roleName === "Owner") ownerRoleId = roleId;
      const codes = perms === ALL ? allCodes : (perms as string[]);
      for (const code of codes) {
        await client.query(
          `insert into role_permissions (role_id, permission_code) values ($1,$2) on conflict do nothing`,
          [roleId, code]
        );
      }
    }

    await client.query(
      `insert into company_members (company_id, user_id, role_id, is_owner) values ($1,$2,$3,true)`,
      [companyId, opts.ownerUserId, ownerRoleId]
    );

    const branch = await client.query(
      `insert into branches (company_id, name, is_main) values ($1,'Magasin principal',true) returning id`,
      [companyId]
    );
    await client.query(
      `insert into warehouses (company_id, branch_id, name, is_default) values ($1,$2,'Dépôt principal',true)`,
      [companyId, branch.rows[0].id]
    );

    for (let i = 0; i < DEFAULT_PAYMENT_METHODS.length; i++) {
      const m = DEFAULT_PAYMENT_METHODS[i];
      await client.query(
        `insert into payment_methods (company_id, name, code, kind, position) values ($1,$2,$3,$4,$5)`,
        [companyId, m.name, m.code, m.kind, i]
      );
    }
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await client.query(
        `insert into expense_categories (company_id, name) values ($1,$2)`,
        [companyId, name]
      );
    }
    for (const [docType, prefix] of DOC_SEQUENCES) {
      await client.query(
        `insert into document_sequences (company_id, doc_type, prefix) values ($1,$2,$3)`,
        [companyId, docType, prefix]
      );
    }
    await client.query(
      `insert into units (company_id, name, abbreviation, allow_decimal) values
        ($1,'Pièce','pc',false), ($1,'Kilogramme','kg',true), ($1,'Litre','L',true), ($1,'Mètre','m',true)`,
      [companyId]
    );

    await client.query(
      `insert into audit_logs (company_id, user_id, action, entity_type, entity_id, entity_label)
       values ($1,$2,'create','company',$1,$3)`,
      [companyId, opts.ownerUserId, opts.name]
    );

    await client.query("commit");
    return { companyId };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
