import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { INGEST_KEY_HEADER, isWellFormedKey, keyKind, type KeyKind } from '@syncline/protocol';
import { ProjectService, type ResolvedProject } from './project.service.js';

const REQUIRED_KEY_KIND = Symbol('REQUIRED_KEY_KIND');

/** Declares which kind of key an endpoint accepts. Public keys can never reach a secret route. */
export const RequireKey = (kind: KeyKind) => SetMetadata(REQUIRED_KEY_KIND, kind);

export const CurrentProject = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ResolvedProject => ctx.switchToHttp().getRequest().project
);

/**
 * Authenticates an ingest request and, for browser keys, checks the origin allowlist.
 *
 * The origin check is what makes a public key safe to ship in a bundle: anyone can read the key,
 * but only the project's own sites can spend it. See docs/ARCHITECTURE.md §4.
 */
@Injectable()
export class IngestKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projects: ProjectService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<KeyKind | undefined>(
      REQUIRED_KEY_KIND,
      context.getHandler()
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const key = request.headers[INGEST_KEY_HEADER];

    if (typeof key !== 'string' || !isWellFormedKey(key)) {
      throw new UnauthorizedException(`missing or malformed ${INGEST_KEY_HEADER}`);
    }

    const kind = keyKind(key);
    if (kind !== required) {
      // Naming the expectation is a deliberate trade: it tells an attacker nothing they cannot
      // infer from the docs, and saves an integrator an afternoon.
      throw new UnauthorizedException(`this endpoint requires a ${required} key`);
    }

    const project =
      kind === 'public'
        ? await this.projects.byPublicKey(key)
        : await this.projects.bySecretKey(key);

    if (!project) throw new UnauthorizedException('unknown API key');

    if (kind === 'public') {
      const origin = request.headers.origin;
      if (typeof origin !== 'string') {
        throw new ForbiddenException('browser ingest requires an Origin header');
      }
      if (!project.origins.includes(origin)) {
        throw new ForbiddenException(`origin ${origin} is not allowed for this project`);
      }
    }

    request.project = project;
    return true;
  }
}
