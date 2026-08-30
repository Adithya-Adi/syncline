import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { INGEST_KEY_HEADER } from '@syncline/protocol';
import { AppModule } from './app/app.module.js';
import { CONFIG, type AppConfig } from './app/config/config.js';

async function bootstrap() {
  // No body parser anywhere. The ingest routes read the raw stream themselves so the compressed
  // bytes are stored exactly as they arrived, and so attacker-controlled gzip is never inflated
  // on an HTTP connection. Every other route is a GET.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get<AppConfig>(CONFIG);

  app.setGlobalPrefix('v1');

  // Any origin may attempt ingest; the guard decides whether the key and origin actually match a
  // project. Enforcing the allowlist here instead would mean reloading CORS config on every
  // project change, and would turn an authorization failure into an opaque browser error.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'content-encoding', INGEST_KEY_HEADER],
    maxAge: 86_400,
  });

  // No ValidationPipe: request bodies are validated with zod schemas from @syncline/protocol,
  // which is also what the browser SDK builds them with. One schema, both sides.
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  Logger.log(
    `syncline api listening on http://localhost:${config.API_PORT}/v1`,
    'Bootstrap',
  );
}

bootstrap();
