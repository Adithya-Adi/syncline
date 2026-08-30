import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { createProject } from '@/lib/projects';
import { requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New project' };

export default async function NewProjectPage() {
  const viewer = await requireViewer();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/projects"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Projects
      </Link>

      <PageHeader
        className="mt-4"
        title="New project"
        description="A project owns a pair of API keys and the list of origins allowed to send recordings to it. Most teams want one per application rather than one per environment — a recording already carries its release."
      />

      <Card className="mt-6">
        <CardContent>
          <form action={createProject} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                autoFocus
                placeholder="Checkout"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="origins">Allowed origins</Label>
              <Textarea
                id="origins"
                name="origins"
                rows={3}
                className="font-mono text-xs"
                placeholder={'https://app.acme.com\nhttp://localhost:3000'}
              />
              <p className="text-xs text-muted-foreground">
                One per line. Recordings are refused from anywhere else, which
                is what makes the public key safe to ship in a bundle.
              </p>
            </div>

            <Button type="submit">
              Create project in {viewer.organizationName}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
