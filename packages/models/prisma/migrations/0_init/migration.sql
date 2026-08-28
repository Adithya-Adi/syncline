-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "origins" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "release" TEXT,
    "userAgent" TEXT,
    "url" TEXT,
    "viewport" JSONB,
    "clockOffsetMs" INTEGER NOT NULL DEFAULT 0,
    "rttMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "meta" JSONB,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,

    CONSTRAINT "SessionChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "clientStartMs" BIGINT NOT NULL,
    "clientEndMs" BIGINT NOT NULL,

    CONSTRAINT "RequestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Span" (
    "traceId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "startNs" BIGINT NOT NULL,
    "endNs" BIGINT NOT NULL,
    "durationNs" BIGINT NOT NULL,
    "statusCode" TEXT,
    "statusMsg" TEXT,
    "attributes" JSONB NOT NULL,

    CONSTRAINT "Span_pkey" PRIMARY KEY ("traceId","spanId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicKey_key" ON "Project"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Project_secretKey_key" ON "Project"("secretKey");

-- CreateIndex
CREATE INDEX "Session_projectId_startedAt_idx" ON "Session"("projectId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SessionChunk_sessionId_seq_key" ON "SessionChunk"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "RequestLink_sessionId_clientStartMs_idx" ON "RequestLink"("sessionId", "clientStartMs");

-- CreateIndex
CREATE INDEX "RequestLink_traceId_idx" ON "RequestLink"("traceId");

-- CreateIndex
CREATE INDEX "Span_traceId_startNs_idx" ON "Span"("traceId", "startNs");

-- CreateIndex
CREATE INDEX "Span_serviceName_startNs_idx" ON "Span"("serviceName", "startNs");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChunk" ADD CONSTRAINT "SessionChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLink" ADD CONSTRAINT "RequestLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
