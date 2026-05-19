-- 010_invitations_hr_fields.sql
--
-- Phase 1b of the three-tier-role rollout (2026-05):
-- correction to migration 009.
--
-- Context: migration 009 created a NEW `staff_invitations` table to
-- power the magic-link invite flow, but the codebase already had a
-- working `invitations` table (used by the Staff Activity invite
-- form, the join.html accept page, and the send-invite.js Netlify
-- function). The new table duplicated existing infrastructure, so
-- we drop it here and extend the existing `invitations` table with
-- the HR-prefill columns and multi-store-manager array that the
-- three-tier rollout needs.
--
-- After this migration runs:
--   - public.staff_invitations is gone (was unused — never wired to UI)
--   - public.invitations has six new columns: full_name, phone_number,
--     hire_date, store_role, employee_id, manager_store_ids
--   - The existing send_invitation() RPC continues to work unchanged;
--     the dashboard invite form does a follow-up UPDATE on the new
--     HR columns using the returned token to identify the row.
--
-- Safe to re-run (DROP IF EXISTS, ADD COLUMN IF NOT EXISTS).

-- ════════════════════════════════════════════════════════════════════
-- §1  Drop the orphaned staff_invitations table
-- ════════════════════════════════════════════════════════════════════
-- CASCADE drops the indexes and RLS policies we created in 009.
-- Safe because nothing in production wrote to or read from this table.

DROP TABLE IF EXISTS public.staff_invitations CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- §2  Extend the existing invitations table with HR + multi-store fields
-- ════════════════════════════════════════════════════════════════════
-- These columns are OPTIONAL pre-fill data captured by the inviter
-- on the dashboard. On accept, join.html displays them pre-filled,
-- lets the invitee edit, and writes the final values to
-- organisation_members + store_manager_stores.

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS full_name         text,
  ADD COLUMN IF NOT EXISTS phone_number      text,
  ADD COLUMN IF NOT EXISTS hire_date         date,
  ADD COLUMN IF NOT EXISTS store_role        text,
  ADD COLUMN IF NOT EXISTS employee_id       text,
  ADD COLUMN IF NOT EXISTS manager_store_ids uuid[];

COMMENT ON COLUMN public.invitations.full_name IS
  'Pre-fill for organisation_members.full_name. Set by the inviter on the dashboard form; invitee can edit on the accept page.';
COMMENT ON COLUMN public.invitations.phone_number IS
  'Pre-fill for organisation_members.phone_number. Optional.';
COMMENT ON COLUMN public.invitations.hire_date IS
  'Pre-fill for organisation_members.hire_date. Optional.';
COMMENT ON COLUMN public.invitations.store_role IS
  'Pre-fill for organisation_members.store_role — free-text on-the-floor role like cashier, stocker, deli. Optional.';
COMMENT ON COLUMN public.invitations.employee_id IS
  'Pre-fill for organisation_members.employee_id — internal/badge number used by the retailer. Optional.';
COMMENT ON COLUMN public.invitations.manager_store_ids IS
  'For role=store_manager invites covering multiple stores: the array of store IDs the new manager will be assigned to. On accept, one row is inserted into store_manager_stores for each ID. The existing invitations.store_id column is unused for manager invites; manager_store_ids is canonical. NULL for non-manager invites.';

-- Done.