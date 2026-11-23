CREATE TABLE "weather_alert_preferences" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" varchar NOT NULL REFERENCES "whatsapp_connections"("id") ON DELETE cascade,
  "parcel_id" varchar NOT NULL REFERENCES "parcels"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT false NOT NULL,
  "alert_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
  "quiet_hours_start" text,
  "quiet_hours_end" text,
  "daily_cap" integer DEFAULT 3 NOT NULL,
  "config_version" integer DEFAULT 1 NOT NULL,
  "last_evaluated_at" timestamp,
  "last_sent_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "weather_alert_preferences_daily_cap_check" CHECK ("daily_cap" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "weather_alert_preferences_connection_unique" ON "weather_alert_preferences" ("connection_id");
CREATE TABLE "weather_alert_deliveries" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" varchar NOT NULL REFERENCES "whatsapp_connections"("id") ON DELETE cascade,
  "preference_id" varchar NOT NULL REFERENCES "weather_alert_preferences"("id") ON DELETE cascade,
  "alert_type" text NOT NULL,
  "forecast_date" date NOT NULL,
  "config_version" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "weather_alert_deliveries_idempotency_unique" ON "weather_alert_deliveries" ("connection_id", "alert_type", "forecast_date", "config_version");
CREATE INDEX "weather_alert_deliveries_status_idx" ON "weather_alert_deliveries" ("status", "created_at");