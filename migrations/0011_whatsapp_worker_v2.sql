ALTER TABLE "whatsapp_message_events"
  ADD COLUMN IF NOT EXISTS "available_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "lease_until" timestamp,
  ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS "correlation_id" text;
CREATE INDEX IF NOT EXISTS "whatsapp_events_claim_idx"
  ON "whatsapp_message_events" ("status", "available_at", "created_at");
CREATE TABLE IF NOT EXISTS "whatsapp_outbound_messages" (
  "id" serial PRIMARY KEY,
  "idempotency_key" text NOT NULL UNIQUE,
  "recipient" text NOT NULL,
  "body_hash" text NOT NULL,
  "provider_message_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "last_attempt_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "sent_at" timestamp
);