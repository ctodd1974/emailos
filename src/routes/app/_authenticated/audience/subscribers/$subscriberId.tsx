/**
 * Subscriber profile — contact details, state, tags, audiences, suppression
 * and the compliance actions (set status, unsubscribe, suppress).
 *
 * Safety copy is deliberate: unsubscribing or suppressing a contact makes them
 * unmailable, and moving back to `active` does NOT remove the suppression
 * record — the server says so and this page repeats it.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Select,
  Spinner,
  StatusBadge,
  TextInput,
  formatDateTime,
} from "~/components/ui.tsx";
import {
  ErrorNote,
  STATUS_OPTIONS,
  SUPPRESSION_REASON_LABELS,
  SuccessNote,
  TagPill,
  displayName,
  sourceLabel,
} from "~/components/audience/shared.tsx";
import {
  addSubscriberAudience,
  addSubscriberTag,
  getSubscriber,
  removeSubscriberAudience,
  removeSubscriberTag,
  setSubscriberStatus,
  suppressSubscriber,
  unsubscribeSubscriber,
  updateSubscriber,
  audienceOverview,
} from "~/server/api/subscribers.ts";

interface Subscriber {
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
  engaged_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  custom_fields: Record<string, unknown> | null;
  tags: { id: string; name: string; color: string | null }[];
  audiences: { id: string; name: string }[];
}

interface Suppression {
  id: string;
  email: string;
  reason: string;
  created_at: string | null;
}

export const Route = createFileRoute("/app/_authenticated/audience/subscribers/$subscriberId")({
  loader: async ({ context, params }) => {
    const workspaceId = (context as unknown as { currentWorkspace?: { id: string } })?.currentWorkspace?.id;
    if (!workspaceId) return { workspaceId: null as string | null, subscriber: null, suppression: null, options: null };
    const [res, overview] = await Promise.all([
      getSubscriber({ data: { workspaceId, subscriberId: params.subscriberId } }),
      audienceOverview({ data: { workspaceId } }),
    ]);
    return {
      workspaceId,
      subscriber: res.ok ? ((res.data.subscriber as unknown as Subscriber) ?? null) : null,
      suppression: res.ok ? ((res.data.suppression as unknown as Suppression | null) ?? null) : null,
      error: res.ok ? null : res.error.error,
      options: overview.ok
        ? { tags: overview.data.tags, audiences: overview.data.audiences }
        : { tags: [], audiences: [] },
    };
  },
  component: SubscriberProfile,
});

function SubscriberProfile() {
  const loaderData = Route.useLoaderData();
  const { workspaceId, options } = loaderData;

  const [subscriber, setSubscriber] = useState<Subscriber | null>(loaderData.subscriber);
  const [suppression, setSuppression] = useState<Suppression | null>(loaderData.suppression);
  const [error, setError] = useState<string | null>((loaderData as { error?: string | null }).error ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState(loaderData.subscriber?.first_name ?? "");
  const [lastName, setLastName] = useState(loaderData.subscriber?.last_name ?? "");
  const [statusChoice, setStatusChoice] = useState(loaderData.subscriber?.status ?? "active");
  const [tagToAdd, setTagToAdd] = useState("");
  const [audienceToAdd, setAudienceToAdd] = useState("");
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);
  const [confirmSuppress, setConfirmSuppress] = useState(false);

  if (!workspaceId) {
    return <EmptyState title="No workspace selected" description="Pick a workspace from the switcher above." />;
  }
  if (!subscriber) {
    return (
      <div className="space-y-4">
        <ErrorNote message={error ?? "That subscriber does not exist in this workspace."} />
        <Link to="/app/audience/subscribers" className="text-sm text-indigo-300 hover:text-indigo-200">
          ← Back to subscribers
        </Link>
      </div>
    );
  }

  const tags = options?.tags ?? [];
  const audiences = options?.audiences ?? [];
  const availableTags = tags.filter((t) => !subscriber.tags.some((st) => st.id === t.id));
  const availableAudiences = audiences.filter((a) => !subscriber.audiences.some((sa) => sa.id === a.id));

  async function run<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: { error: string } }>, message?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error?.error ?? "That action failed.");
        return null;
      }
      if (message) setNotice(message);
      return res.data as T;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function applyResult(data: { subscriber?: unknown; suppression?: unknown; warning?: string | null } | null) {
    if (!data) return;
    if (data.subscriber) setSubscriber(data.subscriber as Subscriber);
    if ("suppression" in data) setSuppression((data.suppression as Suppression | null) ?? null);
    if (data.warning) setNotice(data.warning);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-neutral-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link to="/app/audience/subscribers" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← Subscribers
          </Link>
          <h1 className="mt-1 break-all text-xl font-semibold text-neutral-100 sm:text-2xl">{subscriber.email}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {displayName(subscriber) ?? "No name on file"} · added {formatDateTime(subscriber.subscribed_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={subscriber.status} label={subscriber.statusLabel} />
          {subscriber.mailable ? (
            <Badge tone="emerald">Mailable</Badge>
          ) : (
            <Badge tone="red">Not mailable</Badge>
          )}
        </div>
      </div>

      {notice ? <SuccessNote message={notice} /> : null}
      <ErrorNote message={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Contact details */}
        <Card className="p-5">
          <h2 className="font-medium text-neutral-100">Contact details</h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = await run(() =>
                updateSubscriber({
                  data: {
                    workspaceId,
                    subscriberId: subscriber.id,
                    firstName,
                    lastName,
                  },
                }),
              );
              applyResult(data as never);
              if (data) setNotice("Contact details saved.");
            }}
          >
            <Field label="Email" hint="Emails are the identity key in a workspace and cannot be edited here.">
              <TextInput value={subscriber.email} disabled />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name">
                <TextInput value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label="Last name">
                <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save details"}
            </Button>
          </form>
        </Card>

        {/* State */}
        <Card className="p-5">
          <h2 className="font-medium text-neutral-100">State</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Status</dt>
              <dd>
                <StatusBadge status={subscriber.status} label={subscriber.statusLabel} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Source</dt>
              <dd className="text-neutral-300">{sourceLabel(subscriber.source)}</dd>
            </div>
            {subscriber.source_detail ? (
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-500">Source detail</dt>
                <dd className="text-right text-neutral-300">{subscriber.source_detail}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Subscribed</dt>
              <dd className="text-neutral-300">{formatDateTime(subscriber.subscribed_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Engaged</dt>
              <dd className="text-neutral-300">{subscriber.engaged_at ? formatDateTime(subscriber.engaged_at) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Last updated</dt>
              <dd className="text-neutral-300">{formatDateTime(subscriber.updated_at)}</dd>
            </div>
          </dl>
        </Card>

        {/* Tags */}
        <Card className="p-5">
          <h2 className="font-medium text-neutral-100">Tags</h2>
          <div className="mt-3 flex flex-wrap gap-1">
            {subscriber.tags.length === 0 ? (
              <p className="text-sm text-neutral-500">No tags on this subscriber yet.</p>
            ) : (
              subscriber.tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  onRemove={async () => {
                    const data = await run(() =>
                      removeSubscriberTag({ data: { workspaceId, subscriberId: subscriber.id, tagId: tag.id } }),
                    );
                    applyResult(data as never);
                  }}
                />
              ))
            )}
          </div>
          {availableTags.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Select value={tagToAdd} onChange={(e) => setTagToAdd(e.target.value)}>
                <option value="">Choose a tag…</option>
                {availableTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={busy || tagToAdd === ""}
                onClick={async () => {
                  const tagId = tagToAdd;
                  setTagToAdd("");
                  const data = await run(() =>
                    addSubscriberTag({ data: { workspaceId, subscriberId: subscriber.id, tagId } }),
                  );
                  applyResult(data as never);
                }}
              >
                Add tag
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-neutral-600">
              {tags.length === 0
                ? "No tags exist in this workspace yet — create one on the Tags page."
                : "Every tag in this workspace is already applied."}
            </p>
          )}
        </Card>

        {/* Audiences */}
        <Card className="p-5">
          <h2 className="font-medium text-neutral-100">Audiences</h2>
          <div className="mt-3">
            {subscriber.audiences.length === 0 ? (
              <p className="text-sm text-neutral-500">Not a member of any audience.</p>
            ) : (
              <ul className="space-y-1">
                {subscriber.audiences.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-neutral-300">{a.name}</span>
                    <button
                      className="text-xs text-neutral-500 hover:text-red-300"
                      disabled={busy}
                      onClick={async () => {
                        const data = await run(() =>
                          removeSubscriberAudience({
                            data: { workspaceId, subscriberId: subscriber.id, audienceId: a.id },
                          }),
                        );
                        applyResult(data as never);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {availableAudiences.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Select value={audienceToAdd} onChange={(e) => setAudienceToAdd(e.target.value)}>
                <option value="">Choose an audience…</option>
                {availableAudiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={busy || audienceToAdd === ""}
                onClick={async () => {
                  const audienceId = audienceToAdd;
                  setAudienceToAdd("");
                  const data = await run(() =>
                    addSubscriberAudience({ data: { workspaceId, subscriberId: subscriber.id, audienceId } }),
                  );
                  applyResult(data as never);
                }}
              >
                Add to audience
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-neutral-600">
              {audiences.length === 0
                ? "No audiences exist in this workspace yet — create one on the Audiences page."
                : "This subscriber is already in every audience."}
            </p>
          )}
        </Card>
      </div>

      {/* Suppression */}
      {suppression ? (
        <Card className="border-red-900/60 bg-red-950/20 p-5">
          <h2 className="font-medium text-red-200">Suppression on file</h2>
          <p className="mt-1 text-sm text-red-200/80">
            {SUPPRESSION_REASON_LABELS[suppression.reason] ?? suppression.reason} · recorded{" "}
            {formatDateTime(suppression.created_at)}. This contact is excluded from every marketing send while the
            suppression record exists.
          </p>
          <p className="mt-1 break-all text-xs text-red-300/70">{suppression.email}</p>
        </Card>
      ) : null}

      {/* Compliance actions */}
      <Card className="p-5">
        <h2 className="font-medium text-neutral-100">Actions</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Changing status here changes the record only — no email is sent and nothing is deleted.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Set status" className="sm:w-56">
            <Select value={statusChoice} onChange={(e) => setStatusChoice(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={busy || statusChoice === subscriber.status}
            onClick={async () => {
              const data = await run(() =>
                setSubscriberStatus({
                  data: { workspaceId, subscriberId: subscriber.id, status: statusChoice },
                }),
              );
              applyResult(data as never);
              if (data && !(data as { warning?: string | null }).warning) setNotice("Status updated.");
            }}
          >
            Apply status
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
          <Button variant="danger" disabled={busy || !subscriber.mailable} onClick={() => setConfirmUnsubscribe(true)}>
            Unsubscribe
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmSuppress(true)}>
            Suppress (manual)
          </Button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Unsubscribing records a suppression with reason <span className="text-neutral-400">unsubscribe</span>;
          suppressing records one with reason <span className="text-neutral-400">manual</span>. Setting the status back
          to active keeps the suppression record — it has to be removed deliberately.
        </p>
      </Card>

      <Modal
        open={confirmUnsubscribe}
        title="Unsubscribe this contact?"
        onClose={() => setConfirmUnsubscribe(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUnsubscribe(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setConfirmUnsubscribe(false);
                const data = await run(() =>
                  unsubscribeSubscriber({ data: { workspaceId, subscriberId: subscriber.id } }),
                );
                applyResult(data as never);
                if (data) setNotice("Subscriber unsubscribed. A suppression record was created (reason: unsubscribe).");
              }}
            >
              Yes, unsubscribe
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          {subscriber.email} becomes unsubscribed and gets a suppression record, so no marketing send can ever include
          them again while that record exists. Their data is kept.
        </p>
      </Modal>

      <Modal
        open={confirmSuppress}
        title="Suppress this contact?"
        onClose={() => setConfirmSuppress(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSuppress(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setConfirmSuppress(false);
                const data = await run(() => suppressSubscriber({ data: { workspaceId, subscriberId: subscriber.id } }));
                applyResult(data as never);
                if (data) setNotice("Subscriber suppressed. Reason recorded: manual.");
              }}
            >
              Yes, suppress
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Suppression is for contacts who should never be mailed (legal requests, internal test addresses, complaints
          handled elsewhere). {subscriber.email} is recorded with reason <span className="text-neutral-100">manual</span>.
        </p>
      </Modal>

      {busy ? <Spinner label="Working…" /> : null}

      <p className="text-xs text-neutral-600">
        Subscribers are never deleted in Phase 1 — suppression and unsubscribe keep the record for compliance and
        history.
      </p>
    </div>
  );
}
