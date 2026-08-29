import { Controller, Get, Header } from '@nestjs/common';
import type { ClockResponse } from '@syncline/protocol';

/**
 * The other half of the SDK's clock calibration (docs/ARCHITECTURE.md §3.5).
 *
 * Deliberately unauthenticated and trivial: it must be fast and uncached, because the SDK measures
 * round-trip time against it and a proxy's cached answer would silently corrupt the offset. It
 * returns nothing that is not already in a `Date` header.
 */
@Controller('clock')
export class ClockController {
  @Get()
  @Header('cache-control', 'no-store')
  now(): ClockResponse {
    return { serverMs: Date.now() };
  }
}
