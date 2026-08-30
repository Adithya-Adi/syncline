-- better-auth 1.7.2 writes account.issuer, but the newest published CLI (1.4.21) does not generate
-- it. Without the column every sign-up fails after the user row is written.
--
-- Added with a default so an install that already has accounts survives, then the default is
-- dropped: the value is always supplied by the library, and leaving a default would hide a future
-- version writing nothing here.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT NOT NULL DEFAULT 'local:credential';
ALTER TABLE "account" ALTER COLUMN "issuer" DROP DEFAULT;
