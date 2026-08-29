import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrismaClient, PostgresSpanStore, type PrismaClient } from '@syncline/models';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Owns the database connection for the process.
 *
 * Nest's lifecycle hooks connect and disconnect explicitly rather than letting Prisma connect
 * lazily, so a bad DATABASE_URL fails at boot instead of on the first request.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;
  readonly spans: PostgresSpanStore;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.client = createPrismaClient({
      url: config.DATABASE_URL,
      maxConnections: config.DATABASE_MAX_CONNECTIONS,
      log: config.DATABASE_LOG,
    });
    this.spans = new PostgresSpanStore(this.client);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
