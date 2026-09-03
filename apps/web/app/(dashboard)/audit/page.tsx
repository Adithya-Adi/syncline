import { describeAuditAction } from '@syncline/models';

import { DataList, DataListHeader, DataListRow } from '@/components/data-list';
import { EmptyState, PageHeader } from '@/components/page-header';
import { recentAuditEvents } from '@/lib/audit';
import { can } from '@/lib/permissions';
import { requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log' };

const COLUMNS = 'minmax(200px,1.2fr) minmax(240px,1.8fr) 190px';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * What has been changed in this organization, and by whom.
 *
 * Only mutations. There is no record here of who watched which recording, and that is deliberate:
 * a log of reads is a surveillance feature wearing an accountability badge, and it would bury the
 * dozen entries that matter under thousands that do not.
 *
 * Restricted to admins and owners. A member cannot change anything the log records, so the only
 * thing this page would give them is a list of their colleagues' movements.
 */
export default async function AuditPage() {
  const viewer = await requireViewer();

  // Reusing members:manage rather than adding a permission that would name exactly one page. The
  // people who can change membership are the people accountable for it.
  if (!can(viewer, 'members:manage')) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-7 px-5 py-7 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Organization"
          title="Audit log"
          description="Your role does not include the audit log. Ask an owner or an admin."
        />
      </main>
    );
  }

  const events = await recentAuditEvents(viewer);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-7 px-5 py-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Organization"
        title="Audit log"
        description={
          <>
            Every change made in{' '}
            <span className="font-medium text-foreground">
              {viewer.organizationName}
            </span>
            : projects, keys, search keys and membership. Viewing a recording is
            not recorded.
          </>
        }
      />

      {events.length === 0 ? (
        <EmptyState title="Nothing recorded yet">
          Entries appear as soon as somebody changes a project, a key or who
          belongs here.
        </EmptyState>
      ) : (
        <DataList columns={COLUMNS} minWidth="720px">
          <DataListHeader columns={COLUMNS}>
            <span>Who</span>
            <span>What</span>
            <span>When</span>
          </DataListHeader>

          {events.map((event) => (
            <DataListRow key={event.id} columns={COLUMNS}>
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {event.actorName || event.actorEmail}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {event.actorEmail}
                </span>
              </span>

              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {describeAuditAction(event.action)}
                  {event.targetLabel && (
                    <span className="font-medium"> {event.targetLabel}</span>
                  )}
                </span>
                {summarize(event.metadata) && (
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {summarize(event.metadata)}
                  </span>
                )}
              </span>

              <span className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {dateFormat.format(event.createdAt)}
                </span>
              </span>
            </DataListRow>
          ))}
        </DataList>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        The {events.length} most recent entries. Entries are kept for as long as
        the organization exists and are not affected by the recording retention
        window.
      </p>
    </main>
  );
}

/**
 * The metadata, as one line.
 *
 * Rendered from whatever the entry happens to carry rather than switched on the action, so a new
 * action shows something sensible on the day it ships instead of an empty cell nobody notices.
 */
function summarize(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';

  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${format(value)}`)
    .join(' · ');
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || 'none';
  if (value && typeof value === 'object') {
    const { from, to } = value as { from?: unknown; to?: unknown };
    if (from !== undefined || to !== undefined) {
      return `${format(from)} → ${format(to)}`;
    }
  }
  return String(value);
}
