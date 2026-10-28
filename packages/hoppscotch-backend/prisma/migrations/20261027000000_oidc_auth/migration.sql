ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
-- Preserve the pre-migration clients' display assumption for existing email rows.
UPDATE "User" SET "emailVerified" = true WHERE "email" IS NOT NULL AND btrim("email") <> '';

CREATE TABLE "OIDCLoginTransaction" (
  "id" TEXT NOT NULL,
  "browserBindingHash" TEXT NOT NULL,
  "encryptedContext" TEXT NOT NULL,
  "configFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OIDCLoginTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OIDCLoginTransaction_expiresAt_idx" ON "OIDCLoginTransaction"("expiresAt");
