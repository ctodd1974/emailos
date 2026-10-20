/**
 * Subscribers — the owned subscriber database (Slice 2).
 *
 * Search (q), filters (status / tag / audience / source), pagination, manual
 * add, CSV import wizard, CSV export that honours the current filters, and a
 * row link to the subscriber profile.
 *
 * Every number on this page comes from the server (real SQL counts); when the
 * workspace is empty we say so instead of showing zeros.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatCard,
  StatusBadge,
  TableShell,
  TextInput,
  downloadTextFile,
  formatDate,
} from "~/components/ui.tsx";
import { AudienceList, ErrorNote, TagList, displayName, sourceLabel, STATUS_OPTIONS } from "~/components/audience/shared.tsx";
import {
  audienceOverview,
  createSubscriber,
  exportSubscribersCsv,
  importSubscribersCsv,
  listSubscribers,
} from "~/server/api/subscribers.ts";
import { detectColumnMapping, looksLikeHeader, parseCsv, positionalMapping } from "~/server/audience/csv.ts";

interface SubscriberRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  statusLabel: string;
  mailable: boolean;
  source: string;
  source_detail: string | null;
  subscribed_at: string | null;
  created_at: string | null;
  tags: { id: string; name: string; color: string | null }[];
  audiences: { id: string; name: string }[];
}

interface ListData {
  rows: SubscriberRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: { total: number; active: number; unsubscribed: number; suppressed: number; bounced: number; complained: number };
}

interface Overview {
  counts: ListData["counts"] | null;
  suppressionCount: number;
  sources: string[];
  tags: { id: string; name: string; color: string | null }[];
  audiences: { id: string; name: string; member_count: number }[];
}

const EMPTY_OVERVIEW: Overview = { counts: null, suppressionCount: 0, sources: [], tags: [], audiences: [] };

export const Route = createFileRoute("/app/_authenticated/audience/subscribers/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ws: typeof search.ws === "string" ? search.ws : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
    tagId: typeof search.tagId === "string" ? search.tagId : undefined,
    audienceId: typeof search.audienceId === "string" ? search.audienceId : undefined,
  }),
  // The filters live in the URL, so the loader can render the first page on the
  // server (no empty flash, and the page is verifiable over plain HTTP).
  loaderDeps: ({ search }) => ({
    q: search.q,
    status: search.status,
    source: search.source,
    tagId: search.tagId,
    audienceId: search.audienceId,
  }),
  loader: async ({ context, deps }) => {
    const workspaceId = (context as unknown as { currentWorkspace?: { id: string } })?.currentWorkspace?.id;
    if (!workspaceId) {
      return { workspaceId: null as string | null, overview: EMPTY_OVERVIEW, firstPage: null as ListData | null };
    }
    const [overviewRes, listRes] = await Promise.all([
      audienceOverview({ data: { workspaceId } }),
      listSubscribers({
        data: {
          workspaceId,
          q: deps?.q?.trim() || undefined,
          status: deps?.status || undefined,
          source: deps?.source || undefined,
          tagId: deps?.tagId || undefined,
          audienceId: deps?.audienceId || undefined,
          page: 1,
          pageSize: 25,
        },
      }),
    ]);
    return {
      workspaceId,
      overview: overviewRes.ok ? (overviewRes.data as unknown as Overview) : EMPTY_OVERVIEW,
      firstPage: listRes.ok ? (listRes.data as unknown as ListData) : null,
    };
  },
  component: SubscribersPage,
});

function SubscribersPage() {
  const { workspaceId, overview, firstPage } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();

  const [filters, setFilters] = useState({
    q: search.q ?? "",
    status: search.status ?? "",
    source: search.source ?? "",
    tagId: search.tagId ?? "",
    audienceId: search.audienceId ?? "",
    page: 1,
  });
  const [list, setList] = useState<ListData | null>(firstPage ?? null);
  const [loading, setLoading] = useState(!firstPage);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load(next = filters) {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listSubscribers({
        data: {
          workspaceId,
          q: next.q.trim() || undefined,
          status: next.status || undefined,
          source: next.source || undefined,
          tagId: next.tagId || undefined,
          audienceId: next.audienceId || undefined,
          page: next.page,
          pageSize: 25,
        },
      });
      if (res.ok) setList(res.data as unknown as ListData);
      else setError(res.error.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load subscribers.");
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever a filter or the page changes. The first render already has
  // the loader's page for exactly these filters, so it does not refetch.
  const initialKey = JSON.stringify({
    q: search.q ?? "",
    status: search.status ?? "",
    source: search.source ?? "",
    tagId: search.tagId ?? "",
    audienceId: search.audienceId ?? "",
  });
  const firstRun = useRef(true);
  useEffect(() => {
    const currentKey = JSON.stringify({
      q: filters.q,
      status: filters.status,
      source: filters.source,
      tagId: filters.tagId,
      audienceId: filters.audienceId,
    });
    if (firstRun.current && currentKey === initialKey) {
      firstRun.current = false;
      return;
    }
    firstRun.current = false;
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.source, filters.tagId, filters.audienceId, filters.page, workspaceId]);

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick a workspace from the switcher above to manage its audience."
      />
    );
  }

  function patch(patchValue: Partial<typeof filters>) {
    setFilters((prev) => ({ ...prev, ...patchValue, page: patchValue.page ?? 1 }));
  }

  const hasFilters =
    filters.q.trim() !== "" ||
    filters.status !== "" ||
    filters.source !== "" ||
    filters.tagId !== "" ||
    filters.audienceId !== "";

  function clearFilters() {
    setFilters({ q: "", status: "", source: "", tagId: "", audienceId: "", page: 1 });
  }

  async function refreshAll() {
    await load();
    await router.invalidate();
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const res = await exportSubscribersCsv({
        data: {
          workspaceId,
          q: filters.q.trim() || undefined,
          status: filters.status || undefined,
          source: filters.source || undefined,
          tagId: filters.tagId || undefined,
          audienceId: filters.audienceId || undefined,
        },
      });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      downloadTextFile(res.data.filename, res.data.csv);
      setNotice(
        res.data.rowCount === 0
          ? "Nothing matched those filters, so the export file is empty (header row only)."
          : `Exported ${res.data.rowCount.toLocaleString()} subscriber(s) as CSV, matching the filters on screen.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const workspaceEmpty = (overview.counts?.total ?? 0) === 0 && !hasFilters;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscribers"
        description="Search, filter, add, import and export the people who belong to this workspace. Suppressed and unsubscribed contacts stay visible here but are never mailable."
        actions={
          <>
            <Button variant="primary" onClick={() => setAdding(true)}>
              + Add subscriber
            </Button>
            <Button onClick={() => setImporting(true)}>Import CSV</Button>
            <Button onClick={exportCsv} disabled={exporting}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </>
        }
      />

      {overview.counts && overview.counts.total > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={overview.counts.total} hint="Everyone in this workspace" />
          <StatCard label="Active" value={overview.counts.active} tone="emerald" hint="Mailable" />
          <StatCard
            label="Unsubscribed"
            value={overview.counts.unsubscribed}
            tone="amber"
            hint="Never mailable"
          />
          <StatCard
            label="Suppressed"
            value={overview.counts.suppressed + overview.counts.bounced + overview.counts.complained}
            tone="red"
            hint="Suppressed, bounced or complained"
          />
        </div>
      ) : null}

      {notice ? <Alert tone="emerald">{notice}</Alert> : null}
      <ErrorNote message={error} />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search" className="lg:col-span-2">
            <TextInput
              placeholder="Email or name…"
              value={filters.q}
              onChange={(e) => patch({ q: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })}>
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tag">
            <Select value={filters.tagId} onChange={(e) => patch({ tagId: e.target.value })}>
              <option value="">Any tag</option>
              {overview.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Audience">
            <Select value={filters.audienceId} onChange={(e) => patch({ audienceId: e.target.value })}>
              <option value="">Any audience</option>
              {overview.audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {overview.sources.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Source</span>
              <Select
                value={filters.source}
                onChange={(e) => patch({ source: e.target.value })}
              >
                <option value="">Any source</option>
                {overview.sources.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {hasFilters ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </Card>

      {loading && !list ? <Spinner label="Loading subscribers…" /> : null}

      {!loading && list && list.rows.length === 0 ? (
        workspaceEmpty ? (
          <EmptyState
            title="No subscribers yet"
            description="This workspace has no subscribers. Add one manually or import a CSV — imported duplicates are skipped, never overwritten."
            actions={
              <>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add your first subscriber
                </Button>
                <Button onClick={() => setImporting(true)}>Import a CSV</Button>
              </>
            }
          />
        ) : (
          <EmptyState
            title="No subscribers match these filters"
            description="Try a different search term, or clear the filters to see the whole workspace."
            actions={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        )
      ) : null}

      {list && list.rows.length > 0 ? (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 font-medium">Subscriber</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium">Audiences</th>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            }
          >
            {list.rows.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-900/60">
                <td className="px-4 py-3">
                  <Link
                    to="/app/audience/subscribers/$subscriberId"
                    params={{ subscriberId: row.id }}
                    className="block"
                  >
                    <span className="font-medium text-neutral-100 hover:text-indigo-300">{row.email}</span>
                    {displayName(row) ? (
                      <span className="block text-xs text-neutral-500">{displayName(row)}</span>
                    ) : null}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} label={row.statusLabel} />
                </td>
                <td className="px-4 py-3 text-neutral-400">{sourceLabel(row.source)}</td>
                <td className="px-4 py-3">
                  <TagList tags={row.tags} />
                </td>
                <td className="px-4 py-3">
                  <AudienceList audiences={row.audiences} />
                </td>
                <td className="px-4 py-3 text-neutral-400">{formatDate(row.subscribed_at ?? row.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/app/audience/subscribers/$subscriberId"
                    params={{ subscriberId: row.id }}
                    className="text-sm text-indigo-300 hover:text-indigo-200"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </TableShell>
          <Pagination
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            onPage={(p) => setFilters((prev) => ({ ...prev, page: p }))}
          />
        </div>
      ) : null}

      <ManualAddModal
        open={adding}
        workspaceId={workspaceId}
        tags={overview.tags}
        audiences={overview.audiences}
        onClose={() => setAdding(false)}
        onCreated={async (email) => {
          setAdding(false);
          setNotice(`${email} was added to this workspace.`);
          await refreshAll();
        }}
      />

      <CsvImportModal
        open={importing}
        workspaceId={workspaceId}
        tags={overview.tags}
        audiences={overview.audiences}
        onClose={() => setImporting(false)}
        onFinished={async (message) => {
          setNotice(message);
          await refreshAll();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual add
// ---------------------------------------------------------------------------
function ManualAddModal({
  open,
  workspaceId,
  tags,
  audiences,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string;
  tags: { id: string; name: string }[];
  audiences: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (email: string) => Promise<void> | void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [audienceId, setAudienceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setTagIds([]);
    setAudienceId("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await createSubscriber({
        data: {
          workspaceId,
          email,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          tagIds,
          audienceId: audienceId || undefined,
        },
      });
      if (!res.ok) {
        // Duplicate email is a normal, expected outcome (409) — say so plainly.
        setError(res.error.error);
        return;
      }
      const created = res.data.subscriber as unknown as SubscriberRow;
      reset();
      await onCreated(created.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that subscriber.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add a subscriber"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="manual-add-form" disabled={saving}>
            {saving ? "Adding…" : "Add subscriber"}
          </Button>
        </>
      }
    >
      <form id="manual-add-form" onSubmit={submit} className="space-y-3">
        <Field label="Email (required)">
          <TextInput
            type="email"
            required
            autoFocus
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <TextInput value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        {tags.length > 0 ? (
          <Field label="Tags" hint="Optional — applied to the new subscriber only.">
            <div className="flex flex-wrap gap-2 rounded-lg border border-neutral-800 p-2">
              {tags.map((t) => {
                const checked = tagIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${
                      checked
                        ? "border-indigo-700 bg-indigo-950/60 text-indigo-200"
                        : "border-neutral-700 bg-neutral-900 text-neutral-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() =>
                        setTagIds((prev) => (checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]))
                      }
                    />
                    {t.name}
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}
        {audiences.length > 0 ? (
          <Field label="Audience" hint="Optional — add the subscriber to one audience.">
            <Select value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
              <option value="">No audience</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <ErrorNote message={error} />
        <p className="text-xs text-neutral-500">
          Manual adds are recorded with source <span className="text-neutral-400">manual</span> so you always know where
          a contact came from.
        </p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// CSV import wizard: upload → column mapping → summary
// ---------------------------------------------------------------------------
interface ImportSummary {
  fileName: string | null;
  delimiter: string;
  columns: string[];
  hasHeader: boolean;
  mapping: { email: number | null; firstName: number | null; lastName: number | null; name: number | null };
  totalRows: number;
  imported: number;
  skippedDuplicate: number;
  failed: number;
  duplicates: { row: number; email: string }[];
  failures: { row: number; email: string; reason: string }[];
  appliedTag: string | null;
  appliedAudience: string | null;
  importedSample: string[];
}

function CsvImportModal({
  open,
  workspaceId,
  tags,
  audiences,
  onClose,
  onFinished,
}: {
  open: boolean;
  workspaceId: string;
  tags: { id: string; name: string }[];
  audiences: { id: string; name: string }[];
  onClose: () => void;
  onFinished: (message: string) => Promise<void> | void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<{ email: number | null; firstName: number | null; lastName: number | null; name: number | null }>({
    email: null,
    firstName: null,
    lastName: null,
    name: null,
  });
  const [tagId, setTagId] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => (csvText.trim() === "" ? null : parseCsv(csvText)), [csvText]);
  const columns = useMemo(() => {
    if (!parsed || parsed.rows.length === 0) return [] as string[];
    return hasHeader ? parsed.rows[0].map((c) => c.trim() || "(blank)") : parsed.rows[0].map((_, i) => `Column ${i + 1}`);
  }, [parsed, hasHeader]);
  const dataRows = useMemo(() => {
    if (!parsed) return [] as string[][];
    return hasHeader ? parsed.rows.slice(1) : parsed.rows;
  }, [parsed, hasHeader]);

  function reset() {
    setStep(1);
    setCsvText("");
    setFileName(null);
    setHasHeader(true);
    setMapping({ email: null, firstName: null, lastName: null, name: null });
    setTagId("");
    setAudienceId("");
    setError(null);
    setSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const preview = parseCsv(text);
      if (preview.rows.length === 0) {
        setError("That file has no rows we can read.");
        return;
      }
      const header = looksLikeHeader(preview.rows[0]);
      setCsvText(text);
      setFileName(file.name);
      setHasHeader(header);
      setMapping(header ? detectColumnMapping(preview.rows[0]) : positionalMapping(preview.rows[0].length));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function runImport() {
    setRunning(true);
    setError(null);
    try {
      const res = await importSubscribersCsv({
        data: {
          workspaceId,
          csvText,
          fileName: fileName ?? undefined,
          hasHeader,
          mapping,
          tagId: tagId || undefined,
          audienceId: audienceId || undefined,
        },
      });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setSummary(res.data as unknown as ImportSummary);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setRunning(false);
    }
  }

  async function finish() {
    const s = summary;
    reset();
    onClose();
    if (s) {
      await onFinished(
        `Import finished: ${s.imported} imported, ${s.skippedDuplicate} skipped as duplicates, ${s.failed} failed.`,
      );
    }
  }

  const mappingSelect = (
    label: string,
    key: "email" | "firstName" | "lastName" | "name",
    allowNone: boolean,
  ) => (
    <Field label={label}>
      <Select
        value={mapping[key] === null ? "" : String(mapping[key])}
        onChange={(e) =>
          setMapping((prev) => ({ ...prev, [key]: e.target.value === "" ? null : Number(e.target.value) }))
        }
      >
        {allowNone ? <option value="">Not in this file</option> : null}
        {columns.map((c, i) => (
          <option key={`${c}-${i}`} value={i}>
            {c}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Modal
      open={open}
      wide
      title="Import subscribers from CSV"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!parsed} onClick={() => setStep(2)}>
              Continue to mapping
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" disabled={running || mapping.email === null} onClick={runImport}>
              {running ? "Importing…" : `Import ${dataRows.length.toLocaleString()} row(s)`}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={finish}>
            Done
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <ol className="flex items-center gap-2 text-xs text-neutral-500">
          {["Upload", "Map columns", "Summary"].map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                step === i + 1 ? "bg-indigo-950/60 text-indigo-200" : ""
              }`}
            >
              <span className="font-semibold">{i + 1}</span> {label}
            </li>
          ))}
        </ol>

        <ErrorNote message={error} />

        {step === 1 ? (
          <div className="space-y-3">
            <Field label="CSV file" hint="Comma, semicolon, tab or pipe delimited. 3 MB / 5,000 rows per import.">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="block w-full text-sm text-neutral-300 file:mr-3 file:rounded-lg file:border file:border-neutral-700 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-sm file:text-neutral-200"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            {parsed ? (
              <p className="text-xs text-neutral-400">
                {fileName} — {parsed.rows.length.toLocaleString()} row(s), delimiter{" "}
                <code className="rounded bg-neutral-800 px-1">{parsed.delimiter === "\t" ? "tab" : parsed.delimiter}</code>,{" "}
                {hasHeader ? "header row detected" : "no header row"}.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Apply tag to imported rows" hint="Optional.">
                <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
                  <option value="">No tag</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Add imported rows to audience" hint="Optional.">
                <Select value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
                  <option value="">No audience</option>
                  {audiences.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
              />
              First row is a header
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {mappingSelect("Email (required)", "email", false)}
              {mappingSelect("Full name", "name", true)}
              {mappingSelect("First name", "firstName", true)}
              {mappingSelect("Last name", "lastName", true)}
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Preview</p>
              <div className="overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full min-w-[420px] text-xs">
                  <thead className="bg-neutral-900/70 text-left text-neutral-500">
                    <tr>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">First</th>
                      <th className="px-3 py-2">Last</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800 text-neutral-300">
                    {dataRows.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{mapping.email === null ? "—" : row[mapping.email] || "—"}</td>
                        <td className="px-3 py-2">{mapping.firstName === null ? "—" : row[mapping.firstName] || "—"}</td>
                        <td className="px-3 py-2">{mapping.lastName === null ? "—" : row[mapping.lastName] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {dataRows.length.toLocaleString()} data row(s). Existing emails are skipped — nothing is ever
                overwritten.
              </p>
            </div>
          </div>
        ) : null}

        {step === 3 && summary ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Imported" value={summary.imported} tone="emerald" />
              <StatCard label="Skipped (duplicate)" value={summary.skippedDuplicate} tone="amber" />
              <StatCard label="Failed" value={summary.failed} tone={summary.failed > 0 ? "red" : "neutral"} />
            </div>
            <p className="text-sm text-neutral-300">
              {summary.totalRows.toLocaleString()} data row(s) read from {summary.fileName ?? "the uploaded file"}.
              {summary.appliedTag ? ` Tag “${summary.appliedTag}” applied.` : ""}
              {summary.appliedAudience ? ` Added to audience “${summary.appliedAudience}”.` : ""}
            </p>
            {summary.importedSample.length > 0 ? (
              <p className="text-xs text-neutral-500">
                Newly added: {summary.importedSample.join(", ")}
                {summary.imported > summary.importedSample.length ? " …" : ""}
              </p>
            ) : null}
            {summary.failures.length > 0 ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Rows that failed</p>
                <ul className="space-y-1 text-xs text-red-300">
                  {summary.failures.map((f) => (
                    <li key={`${f.row}-${f.email}`}>
                      Row {f.row}: {f.email || "(blank)"} — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.duplicates.length > 0 ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Rows skipped as duplicates</p>
                <ul className="space-y-1 text-xs text-amber-300">
                  {summary.duplicates.map((d) => (
                    <li key={`${d.row}-${d.email}`}>
                      Row {d.row}: {d.email} already existed — kept the existing record.
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

