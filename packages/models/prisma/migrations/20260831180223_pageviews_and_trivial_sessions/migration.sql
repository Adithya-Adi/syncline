-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "trivial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SessionChunk" ADD COLUMN     "pageviewOrdinal" INTEGER;

-- CreateTable
CREATE TABLE "Pageview" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "Pageview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pageview_path_idx" ON "Pageview"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Pageview_sessionId_ordinal_key" ON "Pageview"("sessionId", "ordinal");

-- AddForeignKey
ALTER TABLE "Pageview" ADD CONSTRAINT "Pageview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
