/**
 * Segments — deterministic, rule-based groups.
 *
 * Only the fields the engine can actually evaluate are offered (the server
 * returns that vocabulary via segmentCapabilities and rejects anything else).
 * Counts are real SQL counts of this workspace's subscribers, and every count
 * comes with a plain-English explanation of the rules that produced it.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  TableShell,
  TextInput,
  formatDateTime,
} from "~/components/ui.tsx";
import { ErrorNote, SuccessNote, pluralize } from "~/components/audience/shared.tsx";
import {
  createSegment,
  deleteSegment,
  listSegments,
  previewSegment,
  segmentCapabilities,
} from "~/server/api/segments.ts";

interface CapOperator {
  value: string;
  label: string;
}
interface CapField {
  field: string;
  label: string;
  operators: CapOperator[];
  valueKind: "tag" | "audience" | "status" | "source" | "date";
  options: { value: string; label: string }[];
}
interface Capabilities {
  fields: CapField[];
  notes: string;
}

interface Segment {
  id: string;
  name: string;
  description: string | null;
  match_type: "all" | "any";
  ruleDescriptions: string[];
  rule_count?: number;
  count?: number;
  sample?: { id: string; email: string; status: string }[];
  explained?: string;
  created_at: string | null;
}

interface DraftRule {
  field: string;
  operator: string;
  value: string;
}

const EMPTY_CAPS: Capabilities = { fields: [], notes: "" };

export const Route = createFileRoute("/app/_authenticated/audience/segments")({
  loader: async ({ context }) => {
    const workspaceId = (context as unknown as { currentWorkspace?: { id: string } })?.currentWorkspace?.id;
    if (!workspaceId) return { workspaceId: null as string | null, segments: [] as Segment[], capabilities: EMPTY_CAPS };
    const [segmentsRes, capsRes] = await Promise.all([
      listSegments({ data: { workspaceId, evaluate: true } }),
      segmentCapabilities({ data: { workspaceId } }),
    ]);
    return {
      workspaceId,
      segments: segmentsRes.ok ? (segmentsRes.data.segments as unknown as Segment[]) : [],
      capabilities: capsRes.ok ? (capsRes.data as unknown as Capabilities) : EMPTY_CAPS,
    };
  },
  component: SegmentsPage,
});

function SegmentsPage() {
  const { workspaceId, capabilities, segments: initialSegments } = Route.useLoaderData();
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [matchType, setMatchType] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<DraftRule[]>([]);

  const [previewing, setPreviewing] = useState<Segment | null>(null);
  const [preview, setPreview] = useState<Segment | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState<Segment | null>(null);

  // Start the rule builder with one sensible rule once the vocabulary arrives.
  useEffect(() => {
    if (rules.length === 0 && capabilities.fields.length > 0) {
      const first = capabilities.fields[0];
      setRules([{ field: first.field, operator: first.operators[0]?.value ?? "", value: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities.fields.length]);

  async function refresh() {
    if (!workspaceId) return;
    const res = await listSegments({ data: { workspaceId, evaluate: true } });
    if (res.ok) setSegments(res.data.segments as unknown as Segment[]);
    await router.invalidate();
  }

  function fieldFor(field: string): CapField | undefined {
    return capabilities.fields.find((f) => f.field === field);
  }

  function updateRule(index: number, patch: Partial<DraftRule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createSegment({
        data: {
          workspaceId,
          name,
          description: description || undefined,
          matchType,
          rules: rules.map((r) => ({
            field: r.field,
            operator: r.operator,
            value: r.field === "subscribed_at" && r.operator === "within_days" ? Number(r.value) : r.value,
          })),
        },
      });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      const data = res.data as unknown as { count: number; explained: string };
      setNotice(
        `Segment created. ${pluralize(data.count, "subscriber")} match right now — ${data.explained}`,
      );
      setName("");
      setDescription("");
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that segment.");
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(segment: Segment) {
    if (!workspaceId) return;
    setPreviewing(segment);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const res = await previewSegment({ data: { workspaceId, segmentId: segment.id } });
      if (res.ok) setPreview(res.data as unknown as Segment);
      else setError(res.error.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview that segment.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDelete() {
    if (!workspaceId || !deleting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteSegment({ data: { workspaceId, segmentId: deleting.id } });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setNotice("Segment deleted. No subscriber was affected — segments are saved queries, not groups of people.");
      setDeleting(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that segment.");
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceId) {
    return <EmptyState title="No workspace selected" description="Pick a workspace from the switcher above." />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Segments"
        description="Saved rules that fill themselves. Phase 1 supports status, source, tag, audience and date added — behavioural fields arrive once real event data exists."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New segment
          </Button>
        }
      />

      {notice ? <SuccessNote message={notice} /> : null}
      <ErrorNote message={error} />

      {segments.length === 0 ? (
        <EmptyState
          title="No segments yet"
          description="A segment answers a question like “who joined in the last 30 days and is tagged buyer?”. Build one from the fields the engine supports today."
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first segment
            </Button>
          }
        />
      ) : (
        <TableShell
          head={
            <tr>
              <th className="px-4 py-2 font-medium">Segment</th>
              <th className="px-4 py-2 font-medium">Rules</th>
              <th className="px-4 py-2 font-medium">Matches now</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          }
        >
          {segments.map((s) => (
            <tr key={s.id} className="align-top hover:bg-neutral-900/60">
              <td className="px-4 py-3">
                <span className="font-medium text-neutral-100">{s.name}</span>
                <span className="mt-1 block">
                  <Badge tone="slate">{s.match_type === "any" ? "matches any rule" : "matches all rules"}</Badge>
                </span>
                {s.description ? <p className="mt-1 text-xs text-neutral-500">{s.description}</p> : null}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-0.5 text-xs text-neutral-400">
                  {(s.ruleDescriptions ?? []).map((d, i) => (
                    <li key={i}>· {d}</li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3">
                {typeof s.count === "number" ? (
                  <span className="text-neutral-200">{pluralize(s.count, "subscriber")}</span>
                ) : (
                  <span className="text-xs text-neutral-600">Not evaluated</span>
                )}
                {s.explained ? <p className="mt-1 max-w-xs text-xs text-neutral-500">{s.explained}</p> : null}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => void openPreview(s)}>
                    Preview
                  </Button>
                  <Button variant="danger" onClick={() => setDeleting(s)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Card className="p-4">
        <p className="text-xs text-neutral-500">{capabilities.notes}</p>
      </Card>

      {/* Create */}
      <Modal
        open={creating}
        wide
        title="New segment"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-segment-form" disabled={busy || rules.length === 0}>
              {busy ? "Creating…" : "Create segment"}
            </Button>
          </>
        }
      >
        <form id="create-segment-form" onSubmit={handleCreate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name (required)">
              <TextInput required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Recent buyers" />
            </Field>
            <Field label="Match">
              <Select value={matchType} onChange={(e) => setMatchType(e.target.value as "all" | "any")}>
                <option value="all">All rules must match</option>
                <option value="any">Any rule can match</option>
              </Select>
            </Field>
          </div>
          <Field label="Description" hint="Optional — what question this segment answers.">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Rules</p>
            {rules.map((rule, index) => {
              const cap = fieldFor(rule.field);
              return (
                <div key={index} className="grid gap-2 rounded-xl border border-neutral-800 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select
                    value={rule.field}
                    onChange={(e) => {
                      const next = fieldFor(e.target.value);
                      updateRule(index, {
                        field: e.target.value,
                        operator: next?.operators[0]?.value ?? "",
                        value: "",
                      });
                    }}
                  >
                    {capabilities.fields.map((f) => (
                      <option key={f.field} value={f.field}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={rule.operator}
                    onChange={(e) => updateRule(index, { operator: e.target.value, value: "" })}
                  >
                    {(cap?.operators ?? []).map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </Select>
                  {cap?.valueKind === "date" && rule.operator === "within_days" ? (
                    <TextInput
                      type="number"
                      min={1}
                      max={3650}
                      placeholder="Days"
                      value={rule.value}
                      onChange={(e) => updateRule(index, { value: e.target.value })}
                    />
                  ) : cap?.valueKind === "date" ? (
                    <TextInput
                      type="date"
                      value={rule.value}
                      onChange={(e) => updateRule(index, { value: e.target.value })}
                    />
                  ) : (
                    <Select value={rule.value} onChange={(e) => updateRule(index, { value: e.target.value })}>
                      <option value="">Choose…</option>
                      {(cap?.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Button
                    variant="ghost"
                    disabled={rules.length === 1}
                    onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              variant="secondary"
              disabled={rules.length >= 12}
              onClick={() =>
                setRules((prev) => {
                  const first = capabilities.fields[0];
                  if (!first) return prev;
                  return [...prev, { field: first.field, operator: first.operators[0]?.value ?? "", value: "" }];
                })
              }
            >
              + Add rule
            </Button>
          </div>

          <Alert tone="neutral">
            Counts are computed when you save and shown for every segment in the list — they are real counts of this
            workspace&apos;s subscribers, never estimates.
          </Alert>
        </form>
      </Modal>

      {/* Preview */}
      <Modal
        open={previewing !== null}
        title={`Preview “${previewing?.name ?? ""}”`}
        onClose={() => {
          setPreviewing(null);
          setPreview(null);
        }}
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setPreviewing(null);
              setPreview(null);
            }}
          >
            Close
          </Button>
        }
      >
        {previewLoading ? (
          <Spinner label="Counting matching subscribers…" />
        ) : preview ? (
          <div className="space-y-3">
            <StatCard label="Matches right now" value={preview.count ?? 0} tone="indigo" />
            <p className="text-sm text-neutral-300">{preview.explained}</p>
            {preview.sample && preview.sample.length > 0 ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">A few of them</p>
                <ul className="space-y-1 text-xs text-neutral-400">
                  {preview.sample.map((m) => (
                    <li key={m.id}>
                      {m.email} · {m.status}
                    </li>
                  ))}
                </ul>
                {(preview.count ?? 0) > (preview.sample?.length ?? 0) ? (
                  <p className="mt-1 text-xs text-neutral-600">
                    Showing {preview.sample.length} of {preview.count}.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No subscribers match these rules right now.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Nothing to show.</p>
        )}
      </Modal>

      {/* Delete */}
      <Modal
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ""}”?`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={handleDelete}>
              {busy ? "Deleting…" : "Delete segment"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          This removes the saved rules only. Subscribers are not touched — a segment is a saved query, not a group of
          people.
        </p>
        {deleting?.created_at ? (
          <p className="mt-2 text-xs text-neutral-600">Created {formatDateTime(deleting.created_at)}</p>
        ) : null}
      </Modal>

      {busy ? <Spinner label="Working…" /> : null}
    </div>
  );
}
