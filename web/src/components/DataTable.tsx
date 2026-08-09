"use client";
import { ReactNode } from "react";
import { useI18n } from "./I18nProvider";
import { Button } from "./ui";

export type Column<T> = {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  align?: "start" | "end";
  className?: string;
};

export function DataTable<T extends { id?: string }>({
  columns, rows, onRowClick, footer,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 font-medium ${c.align === "end" ? "text-end" : "text-start"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line last:border-0 ${onRowClick ? "cursor-pointer hover:bg-canvas" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 ${c.align === "end" ? "text-end" : "text-start"} ${c.className ?? ""}`}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function Pagination({ page, setPage, hasMore, total, limit }: {
  page: number; setPage: (p: number) => void; hasMore?: boolean; total?: number; limit?: number;
}) {
  const { t } = useI18n();
  const pages = total && limit ? Math.max(1, Math.ceil(total / limit)) : null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-ink-3">
      <span>
        {t("common.page")} <span className="num">{page}</span>
        {pages ? <> {t("common.of")} <span className="num">{pages}</span></> : null}
        {total != null && <span className="num"> · {total}</span>}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" className="h-7 px-2.5 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t("common.previous")}
        </Button>
        <Button variant="secondary" className="h-7 px-2.5 text-xs"
          disabled={pages ? page >= pages : !hasMore} onClick={() => setPage(page + 1)}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}
