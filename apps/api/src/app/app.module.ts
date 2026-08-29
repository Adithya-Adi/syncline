import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig } from './config/config.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ProjectService } from './auth/project.service.js';
import { IngestKeyGuard } from './auth/ingest-key.guard.js';
import { ProjectController } from './auth/project.controller.js';
import { ClockController } from './clock/clock.controller.js';
import { IngestController } from './ingest/ingest.controller.js';
import { StorageService } from './storage/storage.service.js';
import { QueueService } from './queue/queue.service.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [ClockController, HealthController, ProjectController, IngestController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    ProjectService,
    StorageService,
    QueueService,
    // Registered globally but inert by default: it only acts on handlers marked with @RequireKey,
    // so adding a route cannot accidentally leave it unauthenticated *or* accidentally lock it.
    { provide: APP_GUARD, useClass: IngestKeyGuard },
  ],
})
export class AppModule {}
