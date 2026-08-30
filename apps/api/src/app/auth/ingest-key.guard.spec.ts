import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { INGEST_KEY_HEADER, type KeyKind } from '@syncline/protocol';
import { IngestKeyGuard } from './ingest-key.guard.js';
import type { ProjectService, ResolvedProject } from './project.service.js';

const PROJECT: ResolvedProject = {
  id: 'proj_1',
  name: 'Local development',
  origins: ['https://app.acme.com'],
};

const PUBLIC_KEY = `pk_${'a'.repeat(43)}`;
const SECRET_KEY = `sk_${'b'.repeat(43)}`;

function contextFor(headers: Record<string, unknown>) {
  const request: Record<string, unknown> = { headers };
  return {
    request,
    ctx: {
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function guardWith(
  required: KeyKind | undefined,
  project: ResolvedProject | null = PROJECT,
) {
  const reflector = { get: () => required } as unknown as Reflector;
  const projects = {
    byPublicKey: jest.fn().mockResolvedValue(project),
    bySecretKey: jest.fn().mockResolvedValue(project),
  } as unknown as ProjectService;
  return { guard: new IngestKeyGuard(reflector, projects), projects };
}

describe('routes without @RequireKey', () => {
  it('are left alone, so adding a route cannot accidentally lock it', async () => {
    const { guard } = guardWith(undefined);
    const { ctx } = contextFor({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('key validation', () => {
  it('rejects a missing key', async () => {
    const { guard } = guardWith('public');
    const { ctx } = contextFor({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a malformed key before touching the database', async () => {
    const { guard, projects } = guardWith('public');
    const { ctx } = contextFor({ [INGEST_KEY_HEADER]: 'pk_short' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(projects.byPublicKey).not.toHaveBeenCalled();
  });

  it('refuses a secret key on a browser route', async () => {
    const { guard } = guardWith('public');
    const { ctx } = contextFor({
      [INGEST_KEY_HEADER]: SECRET_KEY,
      origin: 'https://app.acme.com',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a public key on a server route', async () => {
    const { guard } = guardWith('secret');
    const { ctx } = contextFor({ [INGEST_KEY_HEADER]: PUBLIC_KEY });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a well-formed key that matches no project', async () => {
    const { guard } = guardWith('public', null);
    const { ctx } = contextFor({
      [INGEST_KEY_HEADER]: PUBLIC_KEY,
      origin: 'https://app.acme.com',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('origin allowlist', () => {
  it('is what makes a public key safe to ship in a bundle', async () => {
    const { guard } = guardWith('public');
    const { ctx } = contextFor({
      [INGEST_KEY_HEADER]: PUBLIC_KEY,
      origin: 'https://evil.example',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires an Origin header at all for browser ingest', async () => {
    const { guard } = guardWith('public');
    const { ctx } = contextFor({ [INGEST_KEY_HEADER]: PUBLIC_KEY });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not apply to secret keys, which are not sent by browsers', async () => {
    const { guard } = guardWith('secret');
    const { ctx, request } = contextFor({ [INGEST_KEY_HEADER]: SECRET_KEY });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request['project']).toEqual(PROJECT);
  });

  it('admits an allowlisted origin and attaches the project', async () => {
    const { guard } = guardWith('public');
    const { ctx, request } = contextFor({
      [INGEST_KEY_HEADER]: PUBLIC_KEY,
      origin: 'https://app.acme.com',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request['project']).toEqual(PROJECT);
  });
});
