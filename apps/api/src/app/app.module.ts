import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig } from './config/config.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ProjectService } from './auth/project.service.js';
import { IngestKeyGuard } from './auth/ingest-key.guard.js';
import { ProjectController } from './auth/project.controller.js';
import { ClockController } from './clock/clock.controller.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [ClockController, HealthController, ProjectController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    ProjectService,
    // Registered globally but inert by default: it only acts on handlers marked with @RequireKey,
    // so adding a route cannot accidentally leave it unauthenticated *or* accidentally lock it.
    { provide: APP_GUARD, useClass: IngestKeyGuard },
  ],
})
export class AppModule {}
