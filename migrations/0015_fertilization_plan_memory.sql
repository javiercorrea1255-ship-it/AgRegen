-- Separate structured plans from the conversational summary, which may be regenerated.
ALTER TABLE parcel_memory ADD COLUMN IF NOT EXISTS fertilization_plans jsonb NOT NULL DEFAULT '{}'::jsonb;
