-- CreateTable
CREATE TABLE "ProjectAttributeKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "indexed" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAttributeKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectAttributeKey_projectId_lastSeenAt_idx" ON "ProjectAttributeKey"("projectId", "lastSeenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAttributeKey_projectId_key_key" ON "ProjectAttributeKey"("projectId", "key");

-- AddForeignKey
ALTER TABLE "ProjectAttributeKey" ADD CONSTRAINT "ProjectAttributeKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
