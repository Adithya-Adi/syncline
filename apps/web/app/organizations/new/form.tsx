'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

/**
 * Creating an organization.
 *
 * The slug is derived rather than asked for. It appears in no URL this app serves — Better Auth
 * requires it and enforces uniqueness — so making someone invent one would be asking a question
 * whose answer does not matter to them. A collision is retried with a suffix instead of being
 * reported, which is the only outcome that is not a dead end.
 */

function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'workspace';
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Give the organization a name.');
      return;
    }

    setPending(true);

    const base = slugify(trimmed);
    let created: { id: string } | null = null;
    let failure: string | null = null;

    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      const { data, error: problem } = await authClient.organization.create({
        name: trimmed,
        slug: attempt === 0 ? base : `${base}-${suffix()}`,
      });

      if (data) {
        created = { id: data.id };
        break;
      }

      failure = problem?.message ?? 'Could not create the organization.';
    }

    if (!created) {
      setPending(false);
      setError(failure);
      return;
    }

    // Switching to it immediately: someone who just created an organization means to work in it,
    // and every page below is scoped to whichever one the session says is active.
    await authClient.organization.setActive({ organizationId: created.id });

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form className="mt-8 space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="name">Organization name</Label>
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Engineering"
          autoComplete="organization"
          required
        />
        <p className="text-xs text-muted-foreground">
          Projects, recordings, and members all belong to an organization. You
          will be its owner.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
