/**
 * Small client-side helpers shared by the Audience pages.
 * Presentation only — no data fetching, no secrets, no fabricated values.
 */
import { Alert, Badge } from "~/components/ui.tsx";

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  csv: "CSV import",
  form: "Form",
  api: "API",
  test: "Test",
  import: "Import",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "suppressed", label: "Suppressed" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Complained" },
] as const;

export const SUPPRESSION_REASON_LABELS: Record<string, string> = {
  unsubscribe: "Unsubscribed",
  bounce: "Bounced",
  complaint: "Spam complaint",
  manual: "Manually suppressed",
};

export interface TagRef {
  id: string;
  name: string;
  color?: string | null;
}
export interface AudienceRef {
  id: string;
  name: string;
  member_count?: number;
}

export function TagPill({ tag, onRemove }: { tag: TagRef; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/70 px-2 py-0.5 text-xs text-neutral-300">
      {tag.color ? (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
      ) : null}
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-neutral-500 hover:text-red-300"
          aria-label={`Remove tag ${tag.name}`}
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}

export function TagList({ tags, empty = "No tags" }: { tags: TagRef[] | null | undefined; empty?: string }) {
  if (!tags || tags.length === 0) return <span className="text-xs text-neutral-600">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <TagPill key={t.id} tag={t} />
      ))}
    </span>
  );
}

export function AudienceList({
  audiences,
  empty = "No audiences",
}: {
  audiences: AudienceRef[] | null | undefined;
  empty?: string;
}) {
  if (!audiences || audiences.length === 0) return <span className="text-xs text-neutral-600">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {audiences.map((a) => (
        <Badge key={a.id} tone="slate">
          {a.name}
        </Badge>
      ))}
    </span>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert tone="red">
      <span className="font-medium">Could not complete that: </span>
      {message}
    </Alert>
  );
}

export function SuccessNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <Alert tone="emerald">{message}</Alert>;
}

export function displayName(row: { first_name?: string | null; last_name?: string | null }): string | null {
  const parts = [row.first_name, row.last_name].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Human copy for the workspace a page is showing — never a raw uuid. */
export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
