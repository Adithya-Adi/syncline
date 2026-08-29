import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';

interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, { ok: boolean; error?: string }>;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  /**
   * Answers 503 when a dependency is down so a load balancer can act on it, and still returns the
   * report — "which dependency" is the only useful thing this endpoint can tell you.
   *
   * Redis is checked because ingest accepts a body, stores it, and only then enqueues. If Redis is
   * unreachable the upload has already been paid for by the client and is lost at the last step,
   * so this needs to be visible here rather than discovered as a 500 per request.
   */
  @Get()
  async check(): Promise<HealthReport> {
    const checks: HealthReport['checks'] = {};

    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      checks['database'] = { ok: true };
    } catch (error) {
      checks['database'] = { ok: false, error: (error as Error).message };
    }

    checks['redis'] = (await this.queue.ping())
      ? { ok: true }
      : { ok: false, error: 'ping failed' };

    const ok = Object.values(checks).every((c) => c.ok);
    if (!ok) throw new ServiceUnavailableException({ status: 'degraded', checks });

    return { status: 'ok', checks };
  }
}
