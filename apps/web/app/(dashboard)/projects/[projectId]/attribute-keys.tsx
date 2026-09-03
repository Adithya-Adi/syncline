import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  deleteAttributeKey,
  projectAttributeKeys,
  setAttributeKeyIndexed,
} from '@/lib/attribute-keys';
import { DeleteKeyButton } from './delete-key-button';

const countFormat = new Intl.NumberFormat('en-US');

/**
 * What this project can be searched by.
 *
 * The settings half of indexing on arrival. Keys are never configured before they work — whatever
 * `setContext` sends is searchable immediately — so this page is a record of what turned up rather
 * than a form to fill in, and its job is to make that reversible.
 *
 * It is deliberately not where keys are added. A key appears here because the application sent it;
 * a text box for inventing one would create rows that match no session and a second place for the
 * vocabulary to live.
 */
export async function AttributeKeys({
  projectId,
  canManage,
}: {
  projectId: string;
  /** Whether this viewer's role may switch a key off or delete what is under it. */
  canManage: boolean;
}) {
  const keys = await projectAttributeKeys(projectId);
  const custom = keys.filter((entry) => entry.source === 'custom');
  const builtin = keys.filter((entry) => entry.source === 'builtin');

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Search keys</CardTitle>
        <CardDescription>
          What recordings in this project can be filtered by. Keys appear here
          the first time your application sends one — there is nothing to set
          up.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Call{' '}
            <code className="font-mono text-xs">
              setContext(&#123; accountId: &apos;acct_1&apos; &#125;)
            </code>{' '}
            in your app and the key shows up here after the next recording.
          </p>
        ) : (
          <>
            <section>
              <h3 className="text-sm font-medium">From your application</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Sent by <code className="font-mono">identify()</code> and{' '}
                <code className="font-mono">setContext()</code>. Yours to turn
                off or delete.
              </p>

              {custom.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="mt-3 divide-y rounded-lg border">
                  {custom.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm">{entry.key}</code>
                          {!entry.indexed && (
                            <Badge variant="secondary">Not indexed</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {countFormat.format(entry.values)}{' '}
                          {entry.values === 1 ? 'value' : 'values'} stored ·
                          first seen {formatDate(entry.firstSeenMs)}
                        </p>
                      </div>

                      {canManage && (
                        <div className="flex shrink-0 items-center gap-2">
                          {/*
                           * Two separate acts, and kept separate on purpose. Turning a key off tidies
                           * the filter list and changes nothing already stored; deleting destroys a
                           * month of data. One control doing both is how the second happens by
                           * accident.
                           */}
                          <form action={setAttributeKeyIndexed}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={projectId}
                            />
                            <input type="hidden" name="key" value={entry.key} />
                            <input
                              type="hidden"
                              name="indexed"
                              value={entry.indexed ? 'false' : 'true'}
                            />
                            <Button type="submit" variant="outline" size="sm">
                              {entry.indexed ? 'Stop indexing' : 'Index again'}
                            </Button>
                          </form>

                          <DeleteKeyButton
                            projectId={projectId}
                            attributeKey={entry.key}
                            values={entry.values}
                            action={deleteAttributeKey}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-medium">Derived by Syncline</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Read from the recording itself. Not removable: they are what{' '}
                <code className="font-mono">path:</code> and{' '}
                <code className="font-mono">user:</code> mean, and switching one
                off would not remove the data — it is on the session either way.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {builtin.map((entry) => (
                  <span
                    key={entry.key}
                    className="rounded border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {entry.key}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}
