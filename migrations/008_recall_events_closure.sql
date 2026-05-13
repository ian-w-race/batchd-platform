-- 008_recall_events_closure.sql
--
-- Adds administrative-closure columns to recall_events. Used by the
-- "Mark complete" action on the Live Recall Detail page (Step 7 of the
-- Live Recall pivot, 2026-05). Lets the recall coordinator close out a
-- recall even if some stores haven't independently reached Resolved
-- (e.g., store deactivated, no longer carries the product, lost contact
-- with manager, etc.).
--
-- This is DISTINCT from the all-stores-resolved state which is computed
-- from recall_acknowledgements timestamps. A recall can be:
--   - Open: closed_at IS NULL AND not all acks at 'confirmed'
--   - Naturally completed: closed_at IS NULL AND all acks at 'confirmed'
--   - Administratively closed: closed_at IS NOT NULL
--
-- All three states get the "audit trail locked" treatment in the UI;
-- only the badge wording differs (LIVE / COMPLETED / CLOSED).

ALTER TABLE public.recall_events
  ADD COLUMN IF NOT EXISTS closed_at   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS closed_by   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS closed_note text;

COMMENT ON COLUMN public.recall_events.closed_at IS
  'When the recall was administratively closed by the coordinator (regardless of whether all stores reached Resolved). NULL = still open OR completed naturally via the ack chain.';
COMMENT ON COLUMN public.recall_events.closed_by IS
  'auth.users.id of the coordinator who closed it. NULL when not closed.';
COMMENT ON COLUMN public.recall_events.closed_note IS
  'Optional free-text reason recorded at closure (e.g., "store deactivated").';
