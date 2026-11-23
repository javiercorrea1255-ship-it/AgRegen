ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS voice_preference text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS response_mode text NOT NULL DEFAULT 'brief';

CREATE TABLE IF NOT EXISTS conversation_interaction_states (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parcel_id varchar REFERENCES parcels(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('clarification','escalation','follow_up')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','sending','sent','resolved','cancelled','expired','failed')),
  source_message_id varchar REFERENCES chat_messages(id) ON DELETE SET NULL,
  prompt text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamp,
  available_at timestamp NOT NULL DEFAULT now(),
  lease_until timestamp,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  expires_at timestamp,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_interaction_states_due_idx
  ON conversation_interaction_states(status, due_at);
CREATE INDEX IF NOT EXISTS conversation_interaction_states_conversation_idx
  ON conversation_interaction_states(conversation_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_interaction_states_source_kind_unique
  ON conversation_interaction_states(kind, source_message_id);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  message_id varchar NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parcel_id varchar REFERENCES parcels(id) ON DELETE SET NULL,
  rating text NOT NULL CHECK (rating IN ('helpful','not_helpful')),
  reason text,
  outcome text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recommendation_feedback_message_user_unique
  ON recommendation_feedback(message_id, user_id);

ALTER TABLE conversation_interaction_states
  ADD COLUMN IF NOT EXISTS available_at timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_until timestamp,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;