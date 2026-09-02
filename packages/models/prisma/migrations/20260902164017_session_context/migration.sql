-- AlterTable
ALTER TABLE "SessionAttribute" ADD COLUMN     "numValue" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SessionContext" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "numValue" DOUBLE PRECISION,
    "clientMs" BIGINT NOT NULL,

    CONSTRAINT "SessionContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionContext_sessionId_clientMs_idx" ON "SessionContext"("sessionId", "clientMs");

-- CreateIndex
CREATE UNIQUE INDEX "SessionContext_sessionId_key_clientMs_key" ON "SessionContext"("sessionId", "key", "clientMs");

-- CreateIndex
CREATE INDEX "SessionAttribute_projectId_key_numValue_idx" ON "SessionAttribute"("projectId", "key", "numValue");

-- AddForeignKey
ALTER TABLE "SessionContext" ADD CONSTRAINT "SessionContext_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
