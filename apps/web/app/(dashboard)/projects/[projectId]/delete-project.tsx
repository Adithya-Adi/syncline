'use client';

import { useState } from 'react';
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
import { deleteProject } from '@/lib/projects';

/**
 * The one irreversible control in the product.
 *
 * Behind a disclosure and a typed name rather than a confirm dialog. A dialog is dismissed by
 * reflex — the muscle memory that clicks "OK" is the same one that opened it — whereas typing the
 * project's name cannot be done by accident, and it makes you read which project you are on.
 *
 * The button stays disabled until the name matches. That check is a courtesy: the server compares
 * it again, because this is a public endpoint and the form is not the boundary.
 */
export function DeleteProject({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const matches = typed.trim() === projectName;

  return (
    <Card className="mt-6 border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete this project</CardTitle>
        <CardDescription>
          Every recording, error and trace in {projectName} is deleted, along
          with its keys. Ingest stops accepting them within a minute. This
          cannot be undone.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {open ? (
          <form action={deleteProject} className="space-y-4">
            <input type="hidden" name="projectId" value={projectId} />

            <div className="space-y-2">
              <Label htmlFor="confirm">
                Type <span className="font-mono">{projectName}</span> to confirm
              </Label>
              <Input
                id="confirm"
                name="confirm"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              The project disappears from the dashboard immediately. The
              recordings themselves are erased from storage by the next
              retention sweep, within the hour on a default install.
            </p>

            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={!matches}>
                Delete permanently
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setTyped('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Delete project
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
