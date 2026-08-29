import { Controller, Get } from '@nestjs/common';
import { CurrentProject, RequireKey } from './ingest-key.guard.js';
import type { ResolvedProject } from './project.service.js';

/**
 * Echoes back the project a key resolves to.
 *
 * This is the endpoint an integrator hits first, and the one a future `syncline doctor` will use
 * to tell "wrong key" apart from "right key, wrong origin" — the two failures that look identical
 * from inside a browser.
 */
@Controller('projects')
export class ProjectController {
  @Get('me')
  @RequireKey('public')
  fromBrowserKey(@CurrentProject() project: ResolvedProject) {
    return { id: project.id, name: project.name, origins: project.origins };
  }

  @Get('me/server')
  @RequireKey('secret')
  fromServerKey(@CurrentProject() project: ResolvedProject) {
    return { id: project.id, name: project.name };
  }
}
