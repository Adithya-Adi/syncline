import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  rotatePublicKey,
  rotateSecretKey,
  takeRevealedSecret,
  updateProject,
} from '@/lib/projects';
import { projectForViewer, requireViewer } from '@/lib/session';
import { CopyField } from './copy-field';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ created?: string; rotated?: string; saved?: string }>;
}) {
  const { projectId } = await params;
  const { created, rotated, saved } = await searchParams;

  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);
  if (!project) notFound();

  // Shown once, then gone — there is no stored copy to show a second time.
  const secret = await takeRevealedSecret(project.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/projects"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Projects
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}/recordings`}>
              View recordings
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/projects/${project.id}/setup`}>Set up the SDK</Link>
          </Button>
        </div>
      </div>

      {created && (
        <Alert className="mt-4">
          <AlertDescription>
            Project created. Copy the secret key below — it is shown once.
          </AlertDescription>
        </Alert>
      )}
      {rotated === 'public' && (
        <Alert className="mt-4">
          <AlertDescription>
            Public key rotated. Recording stops until the new key is deployed to
            your site.
          </AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="mt-4">
          <AlertDescription>Saved.</AlertDescription>
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>
            One ships in your bundle, one never leaves your servers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CopyField
            label="Public key"
            value={project.publicKey}
            hint="Ships in your browser bundle. Public by design — the origin allowlist is what protects it."
          />

          {secret ? (
            <CopyField
              label="Secret key"
              value={secret}
              reveal
              hint="Server-side only, for your OpenTelemetry exporter. This is the only time it is shown: only its hash is stored."
            />
          ) : (
            <div className="space-y-2">
              <Label>Secret key</Label>
              <p className="text-xs text-muted-foreground">
                Stored as a hash and not recoverable. Rotate to get a new one —
                the old key stops working immediately.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <form action={rotateSecretKey}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="outline" size="sm">
                Rotate secret key
              </Button>
            </form>

            <form action={rotatePublicKey}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="outline" size="sm">
                Rotate public key
              </Button>
            </form>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Rotating the public key revokes it everywhere at once, which is the
            point — but every browser running the old bundle stops recording
            until you deploy the new one.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateProject} className="space-y-5">
            <input type="hidden" name="projectId" value={project.id} />

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={project.name}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="origins">Allowed origins</Label>
              <Textarea
                id="origins"
                name="origins"
                rows={3}
                className="font-mono text-xs"
                defaultValue={project.origins.join('\n')}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                One per line. Recordings from any other origin are refused with
                a 403 naming the origin, which is usually the fastest way to
                spot a typo here.
              </p>
            </div>

            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
