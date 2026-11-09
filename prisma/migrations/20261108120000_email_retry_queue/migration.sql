-- Persistent email delivery queue. A queued EmailLog row now carries the
-- fully rendered message so the retry sweeper can keep attempting delivery
-- (with exponential backoff) until it succeeds. Existing rows default to
-- terminal states and are never picked up (nextRetryAt stays NULL).
ALTER TABLE "EmailLog" ADD COLUMN "subject" TEXT NOT NULL DEFAULT '';
ALTER TABLE "EmailLog" ADD COLUMN "body" TEXT NOT NULL DEFAULT '';
ALTER TABLE "EmailLog" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailLog" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "EmailLog" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "EmailLog_status_nextRetryAt_idx" ON "EmailLog"("status", "nextRetryAt");
