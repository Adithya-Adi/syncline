-- AlterTable
ALTER TABLE "SessionChunk" ADD COLUMN     "consoleErrorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consoleWarnCount" INTEGER NOT NULL DEFAULT 0;
