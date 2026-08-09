import { z, ZodType } from "zod";
import { withApi, parseBody, pathId, notFound } from "./api";

/**
 * Factory for small reference entities (categories, brands, units…).
 * Produces list/create and update/delete handlers with permission
 * checks and audit logging.
 */
export function makeSimpleCrud(opts: {
  table: string;
  entityType: string;
  viewPerm: string;
  managePerm: string;
  columns: Record<string, string>; // bodyKey -> column
  schema: ZodType<Record<string, unknown>>;
  orderBy?: string;
  softDelete?: boolean;
  extraSelect?: string;
}) {
  const list = withApi(async ({ db, companyId, require }) => {
    await require(opts.viewPerm);
    const soft = opts.softDelete === false ? "" : "and deleted_at is null";
    const r = await db.query(
      `select * ${opts.extraSelect ?? ""} from ${opts.table}
       where company_id = $1 ${soft} order by ${opts.orderBy ?? "name"}`,
      [companyId]
    );
    return { data: r.rows };
  });

  const create = withApi(async ({ req, db, companyId, require, audit }) => {
    await require(opts.managePerm);
    const body = await parseBody(req, opts.schema);
    const keys = Object.keys(opts.columns).filter((k) => body[k] !== undefined);
    const cols = keys.map((k) => opts.columns[k]);
    const params: unknown[] = [companyId, ...keys.map((k) => body[k])];
    const r = await db.query(
      `insert into ${opts.table} (company_id${cols.map((c) => `, ${c}`).join("")})
       values ($1${keys.map((_, i) => `, $${i + 2}`).join("")}) returning id`,
      params
    );
    await audit({
      action: "create", entityType: opts.entityType, entityId: r.rows[0].id,
      entityLabel: String(body.name ?? ""), newValues: body,
    });
    return { id: r.rows[0].id };
  });

  const update = withApi(async ({ req, db, companyId, require, audit }) => {
    await require(opts.managePerm);
    const id = pathId(req);
    const body = await parseBody(req, opts.schema);
    const existing = await db.query(
      `select * from ${opts.table} where id = $1 and company_id = $2`, [id, companyId]
    );
    if (!existing.rowCount) throw notFound();
    const keys = Object.keys(opts.columns).filter((k) => body[k] !== undefined);
    if (keys.length) {
      const params: unknown[] = [...keys.map((k) => body[k]), id, companyId];
      await db.query(
        `update ${opts.table} set ${keys.map((k, i) => `${opts.columns[k]} = $${i + 1}`).join(", ")}
         where id = $${keys.length + 1} and company_id = $${keys.length + 2}`,
        params
      );
    }
    await audit({
      action: "update", entityType: opts.entityType, entityId: id,
      entityLabel: String(body.name ?? existing.rows[0].name ?? ""), newValues: body,
    });
    return { ok: true };
  });

  const remove = withApi(async ({ req, db, companyId, require, audit }) => {
    await require(opts.managePerm);
    const id = pathId(req);
    const existing = await db.query(
      `select * from ${opts.table} where id = $1 and company_id = $2`, [id, companyId]
    );
    if (!existing.rowCount) throw notFound();
    if (opts.softDelete === false) {
      await db.query(`delete from ${opts.table} where id = $1 and company_id = $2`, [id, companyId]);
    } else {
      await db.query(
        `update ${opts.table} set deleted_at = now() where id = $1 and company_id = $2`,
        [id, companyId]
      );
    }
    await audit({
      action: "delete", entityType: opts.entityType, entityId: id,
      entityLabel: String(existing.rows[0].name ?? ""),
    });
    return { ok: true };
  });

  return { list, create, update, remove };
}

export const nameSchema = z.object({ name: z.string().min(1).max(120) });
