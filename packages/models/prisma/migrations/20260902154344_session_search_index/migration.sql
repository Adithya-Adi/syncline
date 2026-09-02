-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedRequestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hasBackendSpans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "missingChunkSeqs" INTEGER[],
ADD COLUMN     "requestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceNames" TEXT[],
ADD COLUMN     "slowestRequestMs" INTEGER;

-- CreateTable
CREATE TABLE "SessionAttribute" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SessionAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionAttribute_projectId_key_value_idx" ON "SessionAttribute"("projectId", "key", "value");

-- CreateIndex
CREATE INDEX "SessionAttribute_sessionId_idx" ON "SessionAttribute"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttribute_sessionId_key_value_key" ON "SessionAttribute"("sessionId", "key", "value");

-- AddForeignKey
ALTER TABLE "SessionAttribute" ADD CONSTRAINT "SessionAttribute_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
