-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "consoleErrorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consoleWarnCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SessionError" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT,
    "message" TEXT NOT NULL,
    "fileUrl" TEXT,
    "line" INTEGER,
    "column" INTEGER,
    "stack" TEXT,
    "clientMs" BIGINT NOT NULL,

    CONSTRAINT "SessionError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionError_sessionId_clientMs_idx" ON "SessionError"("sessionId", "clientMs");

-- AddForeignKey
ALTER TABLE "SessionError" ADD CONSTRAINT "SessionError_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
