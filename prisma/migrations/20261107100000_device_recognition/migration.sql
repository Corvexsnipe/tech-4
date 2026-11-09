-- Device recognition for duplicate-review prevention. Only an HMAC of the
-- first-party cookie token is stored; existing rows keep NULL (no device
-- recorded) so no historical review changes meaning.
ALTER TABLE "Review" ADD COLUMN "deviceHash" TEXT;
ALTER TABLE "Review" ADD COLUMN "deviceHashVersion" INTEGER NOT NULL DEFAULT 1;

-- One active review per device per business. REJECTED/REMOVED rows do not
-- hold the slot, mirroring the ipHash index, so staff can still clear a
-- false-positive rejection and let a retry publish.
CREATE UNIQUE INDEX "Review_businessId_deviceHash_key"
  ON "Review"("businessId", "deviceHash")
  WHERE "deviceHash" IS NOT NULL AND "status" IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'INFO_REQUESTED');
