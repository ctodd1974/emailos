/**
 * Shared UI primitives for the EmailOS app (Tailwind only, no UI dependency).
 * Dark modern SaaS: neutral-950/900 surfaces, restrained indigo accent,
 * high-contrast text, nothing decorative that competes with the data.
 */
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-neutral-800 bg-neutral-900/40 ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-neutral-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-neutral-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-indigo-500 text-white hover:bg-indigo-400 border border-indigo-500",
  secondary: "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700",
  ghost: "bg-transparent text-neutral-400 hover:text-neutral-200 border border-transparent",
  danger: "bg-transparent text-red-300 hover:bg-red-950/40 border border-red-900/70",
};

export function Button({
  children,
  variant = "secondary",
  type = "button",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function labelClass() {
  return "mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500";
}

export const inputClass =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-500 disabled:opacity-60";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass()}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} font-mono text-xs ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

type Tone = "neutral" | "indigo" | "emerald" | "amber" | "red" | "slate";

const TONES: Record<Tone, string> = {
  neutral: "border-neutral-700 bg-neutral-800/70 text-neutral-300",
  indigo: "border-indigo-800 bg-indigo-950/50 text-indigo-300",
  emerald: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  amber: "border-amber-800 bg-amber-950/40 text-amber-300",
  red: "border-red-900 bg-red-950/40 text-red-300",
  slate: "border-slate-700 bg-slate-800/60 text-slate-300",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Status pill — the subscriber state vocabulary, one place. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone: Tone =
    status === "active"
      ? "emerald"
      : status === "unsubscribed"
        ? "amber"
        : status === "suppressed"
          ? "red"
          : status === "bounced"
            ? "amber"
            : status === "complained"
              ? "red"
              : "neutral";
  const text = label ?? status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{text}</Badge>;
}

export function Alert({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-xl border px-3 py-2 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/20 px-6 py-12 text-center">
      <h2 className="text-base font-medium text-neutral-200">{title}</h2>
      {description ? <p className="max-w-md text-sm text-neutral-400">{description}</p> : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          <button onClick={onClose} className="rounded px-2 text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: Tone;
}) {
  const valueTone =
    tone === "red" ? "text-red-300" : tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-neutral-100";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value.toLocaleString()}</p>
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-6 text-center text-sm text-neutral-500">{label}</p>;
}

export function TableShell({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-800">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-neutral-900/70 text-left text-xs uppercase tracking-wide text-neutral-500">{head}</thead>
        <tbody className="divide-y divide-neutral-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="mt-3 text-xs text-neutral-500">{total.toLocaleString()} row(s)</p>;
  }
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
      <span>
        Page {page} of {totalPages} · {total.toLocaleString()} row(s)
      </span>
      <span className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </div>
  );
}

export function formatDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Download helper for the CSV export (client-side blob, no new deps). */
export function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
