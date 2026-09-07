-- The audit log is paged by keyset, on (createdAt, id) rather than createdAt alone: one mutation
-- can write several entries inside the same millisecond, and a cursor on a non-unique column
-- either repeats those rows or skips them. Adding `id` to the index keeps the tiebreaker sorted
-- where the scan already is.
--
-- Additive in effect: nothing else reads this index, and the new one serves every query the old
-- one did, so the drop leaves no read unindexed.

-- DropIndex
DROP INDEX "AuditEvent_organizationId_createdAt_idx";

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_id_idx" ON "AuditEvent"("organizationId", "createdAt" DESC, "id" DESC);
