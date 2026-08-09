"use client";
import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, useEffect } from "react";
import { X, Loader2, Inbox } from "lucide-react";

/* ---------- Button ---------- */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "primary", loading, className = "", children, disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-accent text-white hover:bg-accent-strong border-transparent",
    secondary: "bg-surface text-ink border-line-2 hover:bg-canvas",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-canvas hover:text-ink",
    danger: "bg-danger text-white border-transparent hover:opacity-90",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3.5 h-9 text-sm font-medium
        transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ---------- Inputs ---------- */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      className={`w-full h-9 rounded-lg border border-line-2 bg-surface px-3 text-sm text-ink
        placeholder:text-ink-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full h-9 rounded-lg border border-line-2 bg-surface px-2.5 text-sm text-ink
        outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/* ---------- Card ---------- */
export function Card({ title, actions, children, className = "", pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </div>
  );
}

/* ---------- Badge ---------- */
const badgeTones: Record<string, string> = {
  ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info",
  neutral: "bg-canvas text-ink-2 border border-line",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function paymentTone(status: string): keyof typeof badgeTones {
  return status === "paid" ? "ok" : status === "partial" ? "warn" : status === "refunded" ? "info" : "danger";
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl bg-surface shadow-pop`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-canvas hover:text-ink">
            <X size={17} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- States ---------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-ink-3">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="rounded-full bg-canvas p-3 text-ink-3"><Inbox size={22} /></div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 w-full" />
      ))}
    </div>
  );
}

/* ---------- KPI stat ---------- */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "danger" | "warn" }) {
  const toneCls = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`num mt-1.5 text-[22px] font-semibold leading-tight ${toneCls}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}
