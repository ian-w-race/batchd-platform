# Batch'd database reference

Generated 2026-10-24 18:41 UTC from the production project (lurxucdmrugikdlvvebc) by scripts/schema-reference.sql. Do not edit by hand; regenerate after every migration.

45 tables, 2 views, 42 functions, 148 policies.

# Tables

## code_patterns

Row security: on · Approximate rows: 30
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `created_at` | timestamp with time zone |  | now() |
| `product_name` | text |  |  |
| `code_a` | text |  |  |
| `code_b` | text |  |  |
| `lot_is_first` | boolean |  |  |
| `confirmed_by` | text |  | 'employee'::text |
| `scan_count` | integer |  | 1 |
| `store_name` | text |  |  |
| `lot_format` | text |  |  |
| `batch_format` | text |  |  |
| `label_hint` | text |  |  |
| `barcode_number` | text |  |  |
| `product_key` | text |  |  |
| `brand_key` | text |  |  |
| `confidence_level` | text |  | 'low'::text |
| `location_frequency` | jsonb |  | '{}'::jsonb |
| `organisation_id` | uuid |  | batchd_user_org_id() |
| `crop_y_start` | double precision |  |  |
| `crop_y_end` | double precision |  |  |
| `crop_scan_count` | integer |  | 0 |
| `anchor_before` | text |  |  |
| `anchor_after` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX code_patterns_product_name_idx ON public.code_patterns USING btree (product_name)`
- `CREATE INDEX idx_code_patterns_scan_count ON public.code_patterns USING btree (scan_count DESC)`
- `CREATE INDEX idx_code_patterns_barcode ON public.code_patterns USING btree (barcode_number) WHERE (barcode_number IS NOT NULL)`

**Policies**

- `b33_patterns_platform_admin` ALL to authenticated using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b33_patterns_manager_delete` DELETE to authenticated using `batchd_is_manager_of(organisation_id)`
- `b33_patterns_member_insert` INSERT to authenticated check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b33_patterns_member_select` SELECT to authenticated using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b33_patterns_member_update` UPDATE to authenticated using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))` check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`

## complaint_audit_log

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `complaint_id` | uuid | not null |  |
| `action` | text | not null |  |
| `actor_id` | uuid |  |  |
| `actor_label` | text |  |  |
| `details` | jsonb |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Links: `FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_audit_log_complaint ON public.complaint_audit_log USING btree (complaint_id)`

**Policies**

- `b33_audit_member_insert` INSERT to authenticated check `(complaint_id IN ( SELECT c.id
   FROM complaints c
  WHERE ((c.receiving_org_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids)) OR (c.manufacturer_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids)))))`
- `Orgs view audit log` SELECT to public using `(complaint_id IN ( SELECT complaints.id
   FROM complaints
  WHERE ((complaints.receiving_org_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) OR (complaints.manufacturer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))))))`

## complaint_escalations

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `complaint_id` | uuid | not null |  |
| `from_org_id` | uuid | not null |  |
| `to_org_id` | uuid | not null |  |
| `escalated_by` | uuid |  |  |
| `escalated_at` | timestamp with time zone | not null | now() |
| `message` | text |  |  |
| `status` | text | not null | 'pending'::text |
| `manufacturer_notes` | text |  |  |
| `resolved_at` | timestamp with time zone |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((status = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'investigating'::text, 'resolved'::text])))`
- Links: `FOREIGN KEY (escalated_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (from_org_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (to_org_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `esc_retailer_manage` ALL to public using `(from_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `esc_manufacturer_read` SELECT to public using `(to_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `esc_manufacturer_update` UPDATE to public using `(to_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## complaint_messages

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `complaint_id` | uuid | not null |  |
| `direction` | text | not null |  |
| `channel` | text | not null |  |
| `content` | text | not null |  |
| `sent_by` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((channel = ANY (ARRAY['form'::text, 'email'::text, 'phone'::text, 'system'::text])))`
- Check: `CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))`
- Links: `FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_complaint_messages_complaint ON public.complaint_messages USING btree (complaint_id)`

**Policies**

- `Orgs view complaint messages` SELECT to public using `(complaint_id IN ( SELECT complaints.id
   FROM complaints
  WHERE ((complaints.receiving_org_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) OR (complaints.manufacturer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))))))`

## complaints

Row security: on · Approximate rows: 2
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `complaint_number` | text | not null | ((('CMP-'::text \|\| to_char(now(), 'YYYYMMDD'::text)) \|\| '-'::text) \|\| substr((gen_random_uuid())::text, 1, 6)) |
| `source` | text | not null |  |
| `receiving_org_id` | uuid |  |  |
| `manufacturer_id` | uuid |  |  |
| `product_name` | text |  |  |
| `barcode` | text |  |  |
| `lot_number` | text |  |  |
| `complaint_text` | text | not null |  |
| `customer_name` | text |  |  |
| `customer_email` | text |  |  |
| `customer_phone` | text |  |  |
| `purchase_store` | text |  |  |
| `purchase_date` | date |  |  |
| `incident_date` | date |  |  |
| `still_has_product` | boolean |  |  |
| `triage_level` | text |  |  |
| `triage_category` | text |  |  |
| `triage_summary` | text |  |  |
| `keywords_detected` | text[] |  |  |
| `status` | text | not null | 'new'::text |
| `linked_scan_id` | uuid |  |  |
| `linked_recall_event_id` | uuid |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `country` | text |  |  |
| `store_name` | text |  |  |
| `purchase_city` | text |  |  |
| `purchase_state` | text |  |  |
| `best_before_date` | date |  |  |
| `people_affected` | text |  |  |
| `medical_attention` | text |  |  |
| `storage_method` | text |  |  |
| `lang` | text |  | 'en'::text |
| `smart_matches` | jsonb |  |  |
| `ip_hash` | text |  |  |

**Constraints**

- Check: `CHECK ((source = ANY (ARRAY['widget'::text, 'phone'::text, 'email'::text, 'staff_app'::text])))`
- Check: `CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'follow_up_sent'::text, 'investigating'::text, 'resolved'::text, 'recall_triggered'::text, 'closed'::text])))`
- Check: `CHECK ((triage_level = ANY (ARRAY['critical'::text, 'serious'::text, 'monitor'::text, 'pending'::text])))`
- Links: `FOREIGN KEY (linked_recall_event_id) REFERENCES recall_events(id)`
- Links: `FOREIGN KEY (linked_scan_id) REFERENCES scans(id)`
- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (receiving_org_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (complaint_number)`

**Other indexes**

- `CREATE INDEX idx_complaints_barcode ON public.complaints USING btree (barcode)`
- `CREATE INDEX idx_complaints_country ON public.complaints USING btree (country)`
- `CREATE INDEX idx_complaints_status ON public.complaints USING btree (status)`
- `CREATE INDEX idx_complaints_receiving_org ON public.complaints USING btree (receiving_org_id)`
- `CREATE INDEX idx_complaints_manufacturer ON public.complaints USING btree (manufacturer_id)`
- `CREATE INDEX idx_complaints_created ON public.complaints USING btree (created_at DESC)`
- `CREATE INDEX complaints_ip_hash_created_idx ON public.complaints USING btree (ip_hash, created_at)`
- `CREATE INDEX idx_complaints_triage_level ON public.complaints USING btree (triage_level)`

**Policies**

- `Orgs view own complaints` SELECT to public using `((receiving_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))) OR (manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`
- `Orgs update own complaints` UPDATE to public using `((receiving_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))) OR (manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`

## ftl_overrides

Row security: on · Approximate rows: 0
Table access: authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `gtin` | text |  |  |
| `product_name_normalized` | text |  |  |
| `is_ftl` | boolean | not null |  |
| `ftl_category` | text |  |  |
| `set_by` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK (((gtin IS NOT NULL) OR (product_name_normalized IS NOT NULL)))`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE UNIQUE INDEX ftl_overrides_org_gtin_uidx ON public.ftl_overrides USING btree (organisation_id, gtin) WHERE (gtin IS NOT NULL)`
- `CREATE UNIQUE INDEX ftl_overrides_org_name_uidx ON public.ftl_overrides USING btree (organisation_id, product_name_normalized) WHERE ((gtin IS NULL) AND (product_name_normalized IS NOT NULL))`

**Policies**

- `b25_ftl_overrides_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b25_ftl_overrides_corp_admin_delete` DELETE to public using `batchd_is_corp_admin_of(organisation_id)`
- `b25_ftl_overrides_manager_insert` INSERT to public check `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))`
- `b25_ftl_overrides_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b25_ftl_overrides_manager_update` UPDATE to public using `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))` check `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))`

## ingredient_receipts

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `manufacturer_id` | uuid | not null |  |
| `supplier_id` | uuid |  |  |
| `supplier_name` | text |  |  |
| `ingredient_name` | text | not null |  |
| `lot_number` | text |  |  |
| `quantity` | numeric |  |  |
| `unit` | text |  | 'kg'::text |
| `shipped_at` | timestamp with time zone |  |  |
| `received_at` | timestamp with time zone |  | now() |
| `reference_document` | text |  |  |
| `notes` | text |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (supplier_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_ingredient_receipts_supplier ON public.ingredient_receipts USING btree (supplier_id)`

**Policies**

- `Manufacturers manage ingredient receipts` ALL to public using `(manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## investigation_requests

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `complaint_id` | uuid |  |  |
| `manufacturer_id` | uuid | not null |  |
| `product_name` | text |  |  |
| `barcode` | text |  |  |
| `lot_number` | text |  |  |
| `issue_type` | text | not null |  |
| `issue_description` | text | not null |  |
| `instructions` | text |  |  |
| `urgency_class` | integer |  | 2 |
| `deadline_at` | timestamp with time zone |  |  |
| `status` | text |  | 'open'::text |
| `findings_summary` | text |  |  |
| `recall_escalated` | boolean |  | false |
| `created_by` | uuid |  |  |
| `created_at` | timestamp with time zone |  | now() |
| `updated_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `Manufacturers manage own investigations` ALL to public using `(manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Retailers read investigations from partners` SELECT to public using `(manufacturer_id IN ( SELECT trading_partners.manufacturer_id
   FROM trading_partners
  WHERE ((trading_partners.retailer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) AND (trading_partners.status = 'active'::text))))`

## investigation_responses

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `investigation_id` | uuid | not null |  |
| `retailer_org_id` | uuid | not null |  |
| `store_id` | uuid |  |  |
| `store_name` | text |  |  |
| `responder_user_id` | uuid |  |  |
| `responder_name` | text |  |  |
| `units_inspected` | integer |  |  |
| `units_affected` | integer |  | 0 |
| `issue_found` | boolean |  |  |
| `issue_description` | text |  |  |
| `photos` | jsonb |  | '[]'::jsonb |
| `ai_analysis` | text |  |  |
| `status` | text |  | 'submitted'::text |
| `submitted_at` | timestamp with time zone |  | now() |
| `created_at` | timestamp with time zone |  | now() |
| `supplier_org_id` | uuid |  |  |
| `affected_lots` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (investigation_id) REFERENCES investigation_requests(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (retailer_org_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id)`
- Links: `FOREIGN KEY (supplier_org_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `Retailers manage own responses` ALL to public using `(retailer_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Manufacturers read responses to their investigations` SELECT to public using `(investigation_id IN ( SELECT investigation_requests.id
   FROM investigation_requests
  WHERE (investigation_requests.manufacturer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid())))))`

## invitations

Row security: on · Approximate rows: 9
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `invited_by` | uuid | not null |  |
| `email` | text | not null |  |
| `role` | text | not null |  |
| `store_id` | uuid |  |  |
| `token` | text | not null | encode(gen_random_bytes(32), 'hex'::text) |
| `accepted` | boolean |  | false |
| `created_at` | timestamp with time zone | not null | now() |
| `expires_at` | timestamp with time zone | not null | (now() + '30 days'::interval) |
| `user_id` | uuid |  |  |
| `full_name` | text |  |  |
| `phone_number` | text |  |  |
| `hire_date` | date |  |  |
| `store_role` | text |  |  |
| `employee_id` | text |  |  |
| `manager_store_ids` | uuid[] |  |  |
| `region` | text |  |  |

**Constraints**

- Check: `CHECK (((region IS NULL) OR (region = ANY (ARRAY['us'::text, 'no'::text]))))`
- Check: `CHECK ((role = ANY (ARRAY['corp_admin'::text, 'store_manager'::text, 'staff'::text, 'mfr_admin'::text, 'mfr_qa'::text])))`
- Links: `FOREIGN KEY (invited_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (user_id) REFERENCES auth.users(id)`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (token)`

**Policies**

- `Admins can manage invitations` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = invitations.organisation_id) AND (om.role = ANY (ARRAY['corp_admin'::text, 'mfr_admin'::text, 'platform_admin'::text])))))`
- `b20_inv_admin_delete` DELETE to public using `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_platform_admin())`
- `b20_inv_admin_insert` INSERT to public check `((batchd_is_corp_admin_of(organisation_id) OR batchd_is_platform_admin()) AND (role = ANY (ARRAY['staff'::text, 'store_manager'::text, 'corp_admin'::text])) AND (COALESCE(accepted, false) = false) AND (token IS NOT NULL))`
- `b20_inv_admin_select` SELECT to public using `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_platform_admin())`
- `b20_inv_admin_update` UPDATE to public using `((batchd_is_corp_admin_of(organisation_id) OR batchd_is_platform_admin()) AND (COALESCE(accepted, false) = false))` check `((batchd_is_corp_admin_of(organisation_id) OR batchd_is_platform_admin()) AND (role = ANY (ARRAY['staff'::text, 'store_manager'::text, 'corp_admin'::text])))`

## mock_recall_drills

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `initiated_by_org` | uuid | not null |  |
| `recall_event_id` | uuid | not null |  |
| `target_retailer_id` | uuid |  |  |
| `started_at` | timestamp with time zone | not null | now() |
| `completed_at` | timestamp with time zone |  |  |
| `results` | jsonb |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `scenario_text` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (initiated_by_org) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (recall_event_id) REFERENCES recall_events(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (target_retailer_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `Initiating org can manage their drills` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = mock_recall_drills.initiated_by_org) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'corp_admin'::text, 'platform_admin'::text])))))`
- `Target retailers can view drills aimed at them` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = mock_recall_drills.target_retailer_id))))`

## organisation_api_keys

Row security: on · Approximate rows: 0
Table access: service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `key_hash` | text | not null |  |
| `label` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `revoked_at` | timestamp with time zone |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (key_hash)`

**Policies**

none

## organisation_members

Row security: on · Approximate rows: 14
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `user_id` | uuid | not null |  |
| `role` | text | not null |  |
| `store_id` | uuid |  |  |
| `invited_by` | uuid |  |  |
| `invited_at` | timestamp with time zone |  | now() |
| `joined_at` | timestamp with time zone |  |  |
| `is_batched_admin` | boolean | not null | false |
| `store_group_id` | uuid |  |  |
| `active` | boolean | not null | true |
| `primary_store_id` | uuid |  |  |
| `full_name` | text |  |  |
| `phone_number` | text |  |  |
| `hire_date` | date |  |  |
| `store_role` | text |  |  |
| `employee_id` | text |  |  |
| `deactivated_at` | timestamp with time zone |  |  |
| `deactivated_by` | uuid |  |  |

**Constraints**

- Check: `CHECK ((role = ANY (ARRAY['platform_admin'::text, 'corp_admin'::text, 'store_manager'::text, 'staff'::text, 'mfr_admin'::text, 'mfr_qa'::text])))`
- Links: `FOREIGN KEY (deactivated_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (invited_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (primary_store_id) REFERENCES stores(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (store_group_id) REFERENCES store_groups(id)`
- Links: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (organisation_id, user_id)`

**Other indexes**

- `CREATE UNIQUE INDEX organisation_members_user_org_unique ON public.organisation_members USING btree (user_id, organisation_id)`
- `CREATE INDEX organisation_members_primary_store_idx ON public.organisation_members USING btree (primary_store_id) WHERE (primary_store_id IS NOT NULL)`
- `CREATE INDEX organisation_members_active_role_idx ON public.organisation_members USING btree (organisation_id, role, active)`
- `CREATE INDEX org_members_user_idx ON public.organisation_members USING btree (user_id)`
- `CREATE INDEX org_members_org_idx ON public.organisation_members USING btree (organisation_id)`
- `CREATE INDEX idx_org_members_active ON public.organisation_members USING btree (organisation_id, active)`

**Triggers**

- `batchd_guard_member_insert`: BEFORE INSERT ON organisation_members FOR EACH ROW EXECUTE FUNCTION batchd_guard_member_insert()
- `batchd_guard_member_self_update`: BEFORE UPDATE ON organisation_members FOR EACH ROW EXECUTE FUNCTION batchd_guard_member_self_update()

**Policies**

- `b20_members_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `Org members can view org memberships` SELECT to authenticated using `(organisation_id IN ( SELECT get_my_organisation_ids() AS get_my_organisation_ids))`
- `organisation_members_corp_admin_update` UPDATE to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`
- `organisation_members_manager_update` UPDATE to public using `(batchd_is_manager_of(organisation_id) AND (role = ANY (ARRAY['store_manager'::text, 'staff'::text])) AND ((primary_store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM store_manager_stores s
  WHERE ((s.user_id = auth.uid()) AND (s.store_id = organisation_members.primary_store_id))))))` check `(batchd_is_manager_of(organisation_id) AND (role = ANY (ARRAY['store_manager'::text, 'staff'::text])))`
- `organisation_members_self_update` UPDATE to public using `(user_id = auth.uid())` check `((user_id = auth.uid()) AND (role = batchd_user_role()))`

## organisations

Row security: on · Approximate rows: 9
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `name` | text | not null |  |
| `type` | text | not null |  |
| `region` | text | not null | 'no'::text |
| `billing_status` | text | not null | 'trial'::text |
| `contact_email` | text |  |  |
| `logo_url` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `updated_at` | timestamp with time zone | not null | now() |
| `plan` | text | not null | 'trial'::text |
| `trial_expires_at` | timestamp with time zone |  |  |
| `notes` | text |  |  |
| `is_internal` | boolean | not null | false |
| `recall_coordinator_name` | text |  |  |
| `recall_coordinator_contact` | text |  |  |
| `language` | text |  | 'en'::text |
| `regulatory_frameworks` | jsonb |  | '[]'::jsonb |
| `api_key` | text |  |  |
| `recall_lookback_days` | integer |  | 365 |
| `recall_source` | text | not null | 'both'::text |
| `annual_food_sales_band` | text |  |  |
| `operates_registered_facility` | boolean | not null | false |
| `operates_distribution_center` | boolean | not null | false |
| `fsma_applicability` | text |  |  |
| `focus_categories` | text[] | not null | '{}'::text[] |
| `pricing_tier` | text |  |  |
| `network_benchmarks_opt_in` | boolean | not null | false |
| `traceability_plan_contact_name` | text |  |  |
| `traceability_plan_contact_phone` | text |  |  |
| `traceability_plan_updated_at` | timestamp with time zone |  |  |

**Constraints**

- Check: `CHECK (((annual_food_sales_band IS NULL) OR (annual_food_sales_band = ANY (ARRAY['under_250k'::text, '250k_to_1m'::text, '1m_to_10m'::text, 'over_10m'::text, 'undisclosed'::text]))))`
- Check: `CHECK ((billing_status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text, 'cancelled'::text])))`
- Check: `CHECK (((fsma_applicability IS NULL) OR (fsma_applicability = ANY (ARRAY['exempt'::text, 'covered_no_spreadsheet'::text, 'covered'::text, 'unknown'::text]))))`
- Check: `CHECK (((plan IS NULL) OR (plan = ANY (ARRAY['trial'::text, 'pov'::text, 'active'::text, 'churned'::text]))))`
- Check: `CHECK (((pricing_tier IS NULL) OR (pricing_tier = ANY (ARRAY['pilot'::text, 'starter'::text, 'essential'::text, 'professional'::text, 'readiness'::text]))))`
- Check: `CHECK ((recall_source = ANY (ARRAY['fda'::text, 'mattilsynet'::text, 'both'::text])))`
- Check: `CHECK ((region = ANY (ARRAY['no'::text, 'us'::text])))`
- Check: `CHECK ((type = ANY (ARRAY['retailer'::text, 'manufacturer'::text, 'platform'::text])))`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (api_key)`

**Triggers**

- `batchd_guard_org_commercial_columns`: BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION batchd_guard_org_commercial_columns()

**Policies**

- `b20_orgs_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `Members can view their organisation` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = organisations.id))))`
- `b20_orgs_member_select` SELECT to public using `(id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b20_orgs_partner_select` SELECT to public using `(id IN ( SELECT batchd_my_partner_source_org_ids() AS batchd_my_partner_source_org_ids))`
- `Admins can update their organisation` UPDATE to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = organisations.id) AND (om.role = ANY (ARRAY['corp_admin'::text, 'mfr_admin'::text, 'platform_admin'::text])))))`
- `b20_orgs_corp_admin_update` UPDATE to public using `batchd_is_corp_admin_of(id)` check `batchd_is_corp_admin_of(id)`

## product_lots

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `product_id` | uuid | not null |  |
| `manufacturer_id` | uuid | not null |  |
| `lot_number` | text | not null |  |
| `production_date` | date |  |  |
| `expiry_date` | date |  |  |
| `notes` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX product_lots_product_idx ON public.product_lots USING btree (product_id)`
- `CREATE INDEX product_lots_lot_idx ON public.product_lots USING btree (lot_number)`

**Policies**

- `Manufacturers can manage their product lots` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = product_lots.manufacturer_id) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'platform_admin'::text])))))`
- `Manufacturers can insert product_lots` INSERT to authenticated check `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Manufacturers can select their product_lots` SELECT to authenticated using `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Retailers can view lots from trading partners` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM (trading_partners tp
     JOIN organisation_members om ON ((om.organisation_id = tp.retailer_id)))
  WHERE ((om.user_id = auth.uid()) AND (tp.manufacturer_id = product_lots.manufacturer_id) AND (tp.status = 'active'::text))))`

## products

Row security: on · Approximate rows: 6
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `manufacturer_id` | uuid |  |  |
| `name` | text | not null |  |
| `barcode` | text |  |  |
| `category` | text |  |  |
| `description` | text |  |  |
| `image_url` | text |  |  |
| `is_ftl` | boolean |  | false |
| `ftl_category` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `updated_at` | timestamp with time zone | not null | now() |
| `barcode_normalized` | text |  |  |
| `created_by_org_id` | uuid |  |  |
| `source` | text | not null | 'manufacturer_registered'::text |
| `published` | boolean | not null | true |
| `ftl_confirmed_source` | text |  |  |
| `ftl_confirmed_at` | timestamp with time zone |  |  |

**Constraints**

- Check: `CHECK (((ftl_confirmed_source IS NULL) OR (ftl_confirmed_source = ANY (ARRAY['staff'::text, 'admin'::text, 'wholesaler_feed'::text, 'regex'::text]))))`
- Check: `CHECK ((source = ANY (ARRAY['manufacturer_registered'::text, 'retailer_validated'::text, 'ai_extracted_unverified'::text, 'external_api'::text])))`
- Links: `FOREIGN KEY (created_by_org_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX products_published_lookup ON public.products USING btree (barcode_normalized) WHERE ((published = true) AND (barcode_normalized IS NOT NULL))`
- `CREATE INDEX products_barcode_idx ON public.products USING btree (barcode)`
- `CREATE INDEX products_manufacturer_idx ON public.products USING btree (manufacturer_id)`
- `CREATE UNIQUE INDEX products_barcode_normalized_unique ON public.products USING btree (barcode_normalized) WHERE (barcode_normalized IS NOT NULL)`

**Triggers**

- `products_normalize_barcode`: BEFORE INSERT OR UPDATE OF barcode ON products FOR EACH ROW EXECUTE FUNCTION products_normalize_barcode_trigger()

**Policies**

- `Manufacturers can manage their products` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = products.manufacturer_id) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'platform_admin'::text])))))`
- `Manufacturers can insert products` INSERT to authenticated check `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `scanner_orgs_can_insert_unverified_products` INSERT to authenticated check `((source = ANY (ARRAY['retailer_validated'::text, 'ai_extracted_unverified'::text])) AND (created_by_org_id IS NOT NULL) AND (created_by_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))) AND ((manufacturer_id IS NULL) OR (manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))))`
- `Manufacturers can select their products` SELECT to authenticated using `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Retailers can view partner products` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM (trading_partners tp
     JOIN organisation_members om ON ((om.organisation_id = tp.retailer_id)))
  WHERE ((om.user_id = auth.uid()) AND (tp.manufacturer_id = products.manufacturer_id) AND (tp.status = 'active'::text))))`
- `scanner_orgs_can_update_own_unverified_names` UPDATE to authenticated using `((source = ANY (ARRAY['retailer_validated'::text, 'ai_extracted_unverified'::text])) AND (created_by_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))` check `((source = ANY (ARRAY['retailer_validated'::text, 'ai_extracted_unverified'::text])) AND (created_by_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`

## products_pending

Row security: on · Approximate rows: 184
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `barcode` | text |  |  |
| `barcode_normalized` | text |  |  |
| `name` | text | not null |  |
| `category` | text |  |  |
| `description` | text |  |  |
| `is_ftl` | boolean |  |  |
| `manufacturer_id` | uuid |  |  |
| `created_by_org_id` | uuid |  |  |
| `source` | text | not null | 'ai_extracted_unverified'::text |
| `published` | boolean | not null | true |
| `bootstrap_source` | text | not null |  |
| `confidence_score` | numeric(3,2) |  |  |
| `staging_notes` | text |  |  |
| `conflict_with_pending_ids` | uuid[] |  |  |
| `staged_at` | timestamp with time zone | not null | now() |
| `reviewed_at` | timestamp with time zone |  |  |
| `reviewed_by_user_id` | uuid |  |  |
| `promoted_at` | timestamp with time zone |  |  |
| `promoted_to_product_id` | uuid |  |  |
| `rejected_at` | timestamp with time zone |  |  |
| `rejection_reason` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `updated_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((bootstrap_source = ANY (ARRAY['code_patterns'::text, 'scans'::text, 'manufacturer'::text, 'open_food_facts'::text, 'manual'::text])))`
- Check: `CHECK ((source = ANY (ARRAY['manufacturer_registered'::text, 'retailer_validated'::text, 'ai_extracted_unverified'::text, 'external_api'::text])))`
- Links: `FOREIGN KEY (created_by_org_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (promoted_to_product_id) REFERENCES products(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (reviewed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX products_pending_confidence_idx ON public.products_pending USING btree (confidence_score DESC, staged_at) WHERE (reviewed_at IS NULL)`
- `CREATE INDEX products_pending_unreviewed_idx ON public.products_pending USING btree (staged_at) WHERE (reviewed_at IS NULL)`
- `CREATE INDEX products_pending_barcode_normalized_idx ON public.products_pending USING btree (barcode_normalized) WHERE (barcode_normalized IS NOT NULL)`

**Triggers**

- `products_pending_normalize_barcode`: BEFORE INSERT OR UPDATE OF barcode ON products_pending FOR EACH ROW EXECUTE FUNCTION products_normalize_barcode_trigger()

**Policies**

- `authenticated_can_read_pending` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## recall_acknowledgements

Row security: on · Approximate rows: 20
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `recall_event_id` | uuid | not null |  |
| `store_id` | uuid | not null |  |
| `organisation_id` | uuid | not null |  |
| `acknowledged_by` | uuid |  |  |
| `status` | text | not null | 'notified'::text |
| `units_pulled` | integer |  |  |
| `disposal_method` | text |  |  |
| `notes` | text |  |  |
| `acknowledged_at` | timestamp with time zone |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `units_pulled_confirmed_at` | timestamp with time zone |  |  |
| `units_pulled_confirmed_by` | uuid |  |  |
| `escalation_2h_sent_at` | timestamp with time zone |  |  |
| `escalation_24h_sent_at` | timestamp with time zone |  |  |
| `pulled_at` | timestamp with time zone |  |  |
| `disposed_at` | timestamp with time zone |  |  |
| `confirmed_at` | timestamp with time zone |  |  |

**Constraints**

- Check: `CHECK ((status = ANY (ARRAY['notified'::text, 'acknowledged'::text, 'pulled'::text, 'disposed'::text, 'confirmed'::text])))`
- Links: `FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (recall_event_id) REFERENCES recall_events(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (units_pulled_confirmed_by) REFERENCES auth.users(id)`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (recall_event_id, store_id)`

**Policies**

- `Retailers can manage their acknowledgements` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = recall_acknowledgements.organisation_id) AND (om.role = ANY (ARRAY['corp_admin'::text, 'store_manager'::text, 'staff'::text, 'platform_admin'::text])))))`
- `b20_acks_member_all` ALL to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))` check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b20_acks_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `Manufacturers can view acknowledgements for their recalls` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM (recall_events re
     JOIN organisation_members om ON ((om.organisation_id = re.source_org_id)))
  WHERE ((om.user_id = auth.uid()) AND (re.id = recall_acknowledgements.recall_event_id) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'platform_admin'::text])))))`
- `Retailers can update their acknowledgements` UPDATE to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## recall_consumer_notifications

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `recall_event_id` | uuid |  |  |
| `organisation_id` | uuid | not null |  |
| `notification_type` | text | not null |  |
| `url` | text |  |  |
| `reach_estimate` | integer |  |  |
| `issued_by` | text |  |  |
| `notes` | text |  |  |
| `issued_at` | timestamp with time zone |  | now() |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `Org members manage consumer notifications` ALL to public using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## recall_distributions

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `recall_event_id` | uuid | not null |  |
| `retailer_org_id` | uuid | not null |  |
| `est_affected_units` | integer |  |  |
| `distributed_at` | timestamp with time zone | not null | now() |

**Constraints**

- Links: `FOREIGN KEY (recall_event_id) REFERENCES recall_events(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (retailer_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (recall_event_id, retailer_org_id)`

**Policies**

- `b20_dist_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b20_dist_insert` INSERT to public check `((retailer_org_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids)) AND (recall_event_id IN ( SELECT batchd_my_source_event_ids() AS batchd_my_source_event_ids)))`
- `b20_dist_select` SELECT to public using `((retailer_org_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids)) OR (recall_event_id IN ( SELECT batchd_my_source_event_ids() AS batchd_my_source_event_ids)))`

## recall_effectiveness_checks

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `recall_event_id` | uuid |  |  |
| `organisation_id` | uuid | not null |  |
| `store_id` | uuid |  |  |
| `store_name` | text |  |  |
| `checker_name` | text | not null |  |
| `product_found` | boolean |  | false |
| `units_found` | integer |  | 0 |
| `units_removed` | integer |  | 0 |
| `confirmed_clear` | boolean |  | false |
| `notes` | text |  |  |
| `checked_by_user_id` | uuid |  |  |
| `check_date` | timestamp with time zone |  | now() |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (recall_event_id) REFERENCES recall_events(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id)`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `Org members manage effectiveness checks` ALL to public using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## recall_events

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `source_org_id` | uuid | not null |  |
| `product_id` | uuid |  |  |
| `product_name` | text | not null |  |
| `lot_number` | text |  |  |
| `barcode` | text |  |  |
| `severity` | text | not null | 'class_ii'::text |
| `reason` | text | not null |  |
| `description` | text |  |  |
| `authority_reference` | text |  |  |
| `affected_countries` | text[] |  |  |
| `is_drill` | boolean | not null | false |
| `published_at` | timestamp with time zone |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `cap_data` | jsonb |  |  |
| `authority_ref` | text |  |  |
| `closed_at` | timestamp with time zone |  |  |
| `closed_by` | uuid |  |  |
| `closed_note` | text |  |  |

**Constraints**

- Check: `CHECK ((severity = ANY (ARRAY['class_i'::text, 'class_ii'::text, 'class_iii'::text])))`
- Links: `FOREIGN KEY (closed_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (source_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX recall_events_source_idx ON public.recall_events USING btree (source_org_id)`
- `CREATE INDEX recall_events_barcode_idx ON public.recall_events USING btree (barcode)`
- `CREATE INDEX recall_events_lot_idx ON public.recall_events USING btree (lot_number)`

**Policies**

- `Manufacturers can manage their recall events` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = recall_events.source_org_id) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'platform_admin'::text])))))`
- `b20_events_source_admin_write` ALL to public using `batchd_is_corp_admin_of(source_org_id)` check `batchd_is_corp_admin_of(source_org_id)`
- `b20_events_source_manager_drill` ALL to public using `((is_drill = true) AND batchd_is_manager_of(source_org_id))` check `((is_drill = true) AND batchd_is_manager_of(source_org_id))`
- `Orgs can insert drill recall events` INSERT to authenticated check `((is_drill = true) AND (source_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`
- `Retailers can view recall events distributed to them` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM (recall_distributions rd
     JOIN organisation_members om ON ((om.organisation_id = rd.retailer_org_id)))
  WHERE ((om.user_id = auth.uid()) AND (rd.recall_event_id = recall_events.id))))`
- `Retailers can view recall events targeting them` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM (recall_distributions rd
     JOIN organisation_members om ON ((om.organisation_id = rd.retailer_org_id)))
  WHERE ((om.user_id = auth.uid()) AND (rd.recall_event_id = recall_events.id))))`
- `Source org can read their own recall events` SELECT to authenticated using `(source_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `b20_events_platform_admin` SELECT to public using `batchd_is_platform_admin()`

## recalls

Row security: on · Approximate rows: 9534
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `created_at` | timestamp with time zone |  | now() |
| `product_name` | text |  |  |
| `lot_number` | text |  |  |
| `batch_number` | text |  |  |
| `barcode_number` | text |  |  |
| `description` | text |  |  |
| `active` | boolean |  | true |
| `organisation_id` | uuid |  |  |
| `source_org_id` | uuid |  |  |
| `is_pushed` | boolean |  | false |
| `recall_event_id` | uuid |  |  |
| `source` | text |  |  |
| `potential_duplicate` | boolean |  | false |
| `duplicate_source` | text |  |  |
| `duplicate_ref` | uuid |  |  |
| `resolved_at` | timestamp with time zone |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (source_org_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX recalls_org_idx ON public.recalls USING btree (organisation_id)`

**Triggers**

- `on_recall_activated`: AFTER UPDATE OF active ON recalls FOR EACH ROW WHEN (old.active = false AND new.active = true) EXECUTE FUNCTION trigger_recall_sweep()
- `on_recall_inserted`: AFTER INSERT ON recalls FOR EACH ROW EXECUTE FUNCTION trigger_recall_sweep()

**Policies**

- `b20_recalls_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `Org members can insert recalls` INSERT to authenticated check `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Org members can read recalls` SELECT to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Org members can update recalls` UPDATE to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## receiving_events

Row security: on · Approximate rows: 0
Table access: authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `store_id` | uuid |  |  |
| `supplier_id` | uuid |  |  |
| `supplier_name_snapshot` | text |  |  |
| `product_name` | text | not null |  |
| `gtin` | text |  |  |
| `traceability_lot_code` | text |  |  |
| `tlc_source_type` | text |  |  |
| `tlc_source_reference` | text |  |  |
| `quantity` | numeric | not null |  |
| `unit_of_measure` | text | not null |  |
| `received_at` | timestamp with time zone | not null | now() |
| `reference_document_type` | text |  |  |
| `reference_document_number` | text |  |  |
| `is_ftl` | boolean | not null | false |
| `ftl_category` | text |  |  |
| `ftl_confirmed_by_staff` | boolean | not null | false |
| `pack_date` | date |  |  |
| `best_by` | date |  |  |
| `raw_label_capture` | text |  |  |
| `label_photo_url` | text |  |  |
| `source` | text | not null | 'staff_scan'::text |
| `status` | text | not null | 'received'::text |
| `import_batch_id` | uuid |  |  |
| `received_by` | text |  |  |
| `notes` | text |  |  |
| `client_uuid` | uuid |  |  |
| `retain_until` | timestamp with time zone |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((quantity >= (0)::numeric))`
- Check: `CHECK (((reference_document_type IS NULL) OR (reference_document_type = ANY (ARRAY['PO'::text, 'BOL'::text, 'invoice'::text, 'ASN'::text, 'other'::text]))))`
- Check: `CHECK ((source = ANY (ARRAY['staff_scan'::text, 'wholesaler_import'::text, 'manual_entry'::text])))`
- Check: `CHECK ((status = ANY (ARRAY['expected'::text, 'received'::text, 'rejected'::text])))`
- Check: `CHECK (((tlc_source_type IS NULL) OR (tlc_source_type = ANY (ARRAY['supplier_label'::text, 'shipping_document'::text, 'assigned_by_us'::text, 'not_required_exempt_source'::text]))))`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (client_uuid)`

**Other indexes**

- `CREATE INDEX receiving_events_org_lot_idx ON public.receiving_events USING btree (organisation_id, traceability_lot_code)`
- `CREATE INDEX receiving_events_org_store_received_idx ON public.receiving_events USING btree (organisation_id, store_id, received_at DESC)`
- `CREATE INDEX receiving_events_org_store_status_idx ON public.receiving_events USING btree (organisation_id, store_id, status)`

**Triggers**

- `receiving_events_set_retention`: BEFORE INSERT OR UPDATE OF received_at ON receiving_events FOR EACH ROW EXECUTE FUNCTION batchd_receiving_set_retention()

**Policies**

- `b23_receiving_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b23_receiving_member_insert` INSERT to public check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b23_receiving_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b23_receiving_manager_update` UPDATE to public using `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))` check `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))`
- `b29_receiving_member_confirm_expected` UPDATE to public using `((organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids)) AND (status = 'expected'::text))` check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`

## records_requests

Row security: on · Approximate rows: 0
Table access: authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `is_drill` | boolean | not null | true |
| `requested_at` | timestamp with time zone | not null | now() |
| `requested_by` | text |  |  |
| `scope_lot` | text |  |  |
| `scope_product` | text |  |  |
| `scope_date_from` | date |  |  |
| `scope_date_to` | date |  |  |
| `produced_at` | timestamp with time zone |  |  |
| `produced_by` | text |  |  |
| `row_count` | integer |  |  |
| `minutes_to_produce` | numeric |  | (EXTRACT(epoch FROM (produced_at - requested_at)) / 60.0) (generated) |
| `file_name` | text |  |  |
| `notes` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX records_requests_org_requested_idx ON public.records_requests USING btree (organisation_id, requested_at DESC)`

**Policies**

- `b26_records_requests_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b26_records_requests_corp_admin_insert` INSERT to public check `batchd_is_corp_admin_of(organisation_id)`
- `b26_records_requests_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b26_records_requests_corp_admin_update` UPDATE to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`

## scan_queue

Row security: on · Approximate rows: 0
Table access: service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `created_at` | timestamp with time zone |  | now() |
| `payload` | jsonb | not null |  |
| `synced` | boolean |  | false |

**Constraints**

- Primary key: `PRIMARY KEY (id)`

**Policies**

none

## scan_recall_matches

Row security: on · Approximate rows: 2
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `scan_id` | uuid | not null |  |
| `recall_id` | uuid |  |  |
| `recall_source` | text |  |  |
| `recall_product` | text |  |  |
| `recall_lot` | text |  |  |
| `match_type` | text | not null |  |
| `match_confidence` | text | not null | 'high'::text |
| `matched_at` | timestamp with time zone | not null | now() |
| `matched_by` | text |  | 'system'::text |
| `organisation_id` | uuid | not null |  |
| `store_name` | text |  |  |
| `store_id` | uuid |  |  |
| `scanned_by` | text |  |  |
| `placed_at` | timestamp with time zone |  |  |
| `quantity` | integer |  | 1 |
| `removed_at` | timestamp with time zone |  |  |
| `removed_by` | text |  |  |
| `complaint_id` | uuid |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `recall_event_id` | uuid |  |  |

**Constraints**

- Links: `FOREIGN KEY (recall_event_id) REFERENCES recall_events(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (recall_id) REFERENCES recalls(id)`
- Links: `FOREIGN KEY (scan_id) REFERENCES scans(id)`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_srm_scan ON public.scan_recall_matches USING btree (scan_id)`
- `CREATE INDEX scan_recall_matches_recall_event_id_idx ON public.scan_recall_matches USING btree (recall_event_id)`
- `CREATE INDEX idx_srm_store ON public.scan_recall_matches USING btree (organisation_id, store_name)`
- `CREATE INDEX idx_srm_org ON public.scan_recall_matches USING btree (organisation_id)`
- `CREATE UNIQUE INDEX scan_recall_matches_scan_recall_unique ON public.scan_recall_matches USING btree (scan_id, recall_id)`
- `CREATE INDEX idx_srm_recall ON public.scan_recall_matches USING btree (recall_id)`
- `CREATE INDEX idx_srm_placed ON public.scan_recall_matches USING btree (placed_at DESC)`

**Policies**

- `Authenticated can insert matches` INSERT to authenticated check `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `srm_insert` INSERT to authenticated check `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Org members can read own matches` SELECT to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `srm_org_read` SELECT to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Authenticated can update matches` UPDATE to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `srm_update` UPDATE to authenticated using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## scan_telemetry

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `scan_id` | uuid |  |  |
| `organisation_id` | uuid |  |  |
| `path` | text | not null |  |
| `ai_fallback_reason` | text |  |  |
| `time_to_identification_ms` | integer |  |  |
| `external_apis_timed_out` | boolean |  |  |
| `user_agent` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((ai_fallback_reason = ANY (ARRAY['zxing_decoded_but_unknown'::text, 'zxing_failed_then_prompt'::text, 'user_manual_toggle'::text, NULL::text])))`
- Check: `CHECK ((path = ANY (ARRAY['zxing_success'::text, 'ai_fallback'::text])))`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX scan_telemetry_org_idx ON public.scan_telemetry USING btree (organisation_id, created_at DESC)`
- `CREATE INDEX scan_telemetry_path_created_idx ON public.scan_telemetry USING btree (created_at DESC, path)`

**Policies**

- `b33_telemetry_platform_admin` ALL to authenticated using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `authenticated_can_insert_telemetry` INSERT to authenticated check `((organisation_id IS NULL) OR (organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`
- `b33_telemetry_member_select` SELECT to authenticated using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`

## scans

Row security: on · Approximate rows: 92
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `created_at` | timestamp with time zone |  | now() |
| `product_name` | text |  |  |
| `barcode_number` | text |  |  |
| `lot_number` | text |  |  |
| `batch_number` | text |  |  |
| `product_photo_url` | text |  |  |
| `barcode_photo_url` | text |  |  |
| `store_name` | text |  |  |
| `scanned_by` | text |  |  |
| `notes` | text |  |  |
| `recall_resolved` | boolean |  | false |
| `recall_resolved_by` | text |  |  |
| `recall_resolved_at` | timestamp with time zone |  |  |
| `quantity` | integer |  | 1 |
| `shelf_location` | text |  |  |
| `removed_from_shelf_at` | timestamp with time zone |  |  |
| `removed_from_shelf_by` | text |  |  |
| `manager_escalated` | boolean |  | false |
| `manager_escalated_at` | timestamp with time zone |  |  |
| `manager_escalated_by` | text |  |  |
| `is_ftl` | boolean |  | false |
| `ftl_category` | text |  |  |
| `reference_document` | text |  |  |
| `tlc_source` | text |  |  |
| `supplier_name` | text |  |  |
| `organisation_id` | uuid |  |  |
| `store_id` | uuid |  |  |
| `retain_until` | timestamp with time zone |  |  |
| `audit_note` | text |  |  |
| `complaint_filed` | boolean |  | false |
| `label_text` | text |  |  |
| `expiry_date` | text |  |  |
| `client_uuid` | uuid |  |  |
| `raw_capture` | text |  |  |
| `receiving_event_id` | uuid |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (receiving_event_id) REFERENCES receiving_events(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (client_uuid)`

**Other indexes**

- `CREATE INDEX idx_scans_org_store_created ON public.scans USING btree (organisation_id, store_name, created_at DESC)`
- `CREATE INDEX scans_barcode_normalized_for_promotion ON public.scans USING btree (normalize_barcode(barcode_number), product_name) WHERE ((barcode_number IS NOT NULL) AND (organisation_id IS NOT NULL))`
- `CREATE INDEX scans_org_idx ON public.scans USING btree (organisation_id)`
- `CREATE INDEX scans_store_id_idx ON public.scans USING btree (store_id)`
- `CREATE INDEX idx_scans_label_text ON public.scans USING gin (to_tsvector('simple'::regconfig, COALESCE(label_text, ''::text)))`
- `CREATE INDEX scans_receiving_event_idx ON public.scans USING btree (receiving_event_id)`
- `CREATE INDEX idx_scans_complaint_filed ON public.scans USING btree (organisation_id, complaint_filed) WHERE (complaint_filed = true)`

**Triggers**

- `on_scan_pulled`: AFTER UPDATE OF removed_from_shelf_at ON scans FOR EACH ROW EXECUTE FUNCTION sync_recall_match_removal()
- `scan_immutability_guard`: BEFORE UPDATE ON scans FOR EACH ROW EXECUTE FUNCTION enforce_scan_immutability()
- `scans_audit_trg`: AFTER UPDATE ON scans FOR EACH ROW EXECUTE FUNCTION log_scan_change()
- `scans_promote_product_trust_tier`: AFTER INSERT ON scans FOR EACH ROW EXECUTE FUNCTION promote_product_trust_tier_on_scan()

**Policies**

- `b20_scans_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `scans_no_delete` DELETE to authenticated using `false`
- `Staff update org scans` INSERT to authenticated check `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE ((organisation_members.user_id = auth.uid()) AND (organisation_members.active = true))))`
- `b20_scans_member_insert` INSERT to public check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `Members can view their org scans` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = scans.organisation_id))))`
- `b20_scans_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `mfr_scan_intelligence` SELECT to public using `((lot_number IN ( SELECT pl.lot_number
   FROM (product_lots pl
     JOIN products p ON ((p.id = pl.product_id)))
  WHERE (p.manufacturer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))))) AND (organisation_id IN ( SELECT tp.retailer_id
   FROM trading_partners tp
  WHERE ((tp.manufacturer_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) AND (tp.status = 'active'::text) AND (tp.share_scan_intelligence = true)))))`
- `Staff can update their org scans` UPDATE to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = scans.organisation_id))))`
- `b20_scans_member_update` UPDATE to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))` check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `scans_corp_admin_update` UPDATE to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`
- `scans_manager_correct_store` UPDATE to public using `(batchd_user_is_store_manager() AND (organisation_id = batchd_user_org_id()) AND batchd_user_manages_store(store_id))` check `(batchd_user_is_store_manager() AND (organisation_id = batchd_user_org_id()))`

## scans_audit_log

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `scan_id` | uuid | not null |  |
| `changed_by` | uuid |  |  |
| `changed_at` | timestamp with time zone | not null | now() |
| `field_name` | text | not null |  |
| `old_value` | text |  |  |
| `new_value` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX scans_audit_log_changed_by_idx ON public.scans_audit_log USING btree (changed_by, changed_at DESC) WHERE (changed_by IS NOT NULL)`
- `CREATE INDEX scans_audit_log_scan_idx ON public.scans_audit_log USING btree (scan_id, changed_at DESC)`

**Policies**

- `scans_audit_log_select` SELECT to public using `(EXISTS ( SELECT 1
   FROM scans s
  WHERE ((s.id = scans_audit_log.scan_id) AND (s.organisation_id = batchd_user_org_id()) AND (batchd_user_is_corp_admin() OR batchd_user_manages_store(s.store_id)))))`

## shipments

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `manufacturer_id` | uuid | not null |  |
| `retailer_id` | uuid | not null |  |
| `store_id` | uuid |  |  |
| `product_id` | uuid |  |  |
| `lot_number` | text | not null |  |
| `barcode` | text |  |  |
| `quantity` | integer |  |  |
| `unit` | text |  | 'units'::text |
| `reference_document` | text |  |  |
| `shipped_at` | timestamp with time zone |  |  |
| `received_at` | timestamp with time zone |  |  |
| `notes` | text |  |  |
| `created_at` | timestamp with time zone | not null | now() |

**Constraints**

- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (retailer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX shipments_lot_idx ON public.shipments USING btree (lot_number)`
- `CREATE INDEX shipments_mfr_idx ON public.shipments USING btree (manufacturer_id)`
- `CREATE INDEX shipments_retailer_idx ON public.shipments USING btree (retailer_id)`
- `CREATE INDEX shipments_barcode_idx ON public.shipments USING btree (barcode)`

**Policies**

- `Manufacturers can manage their shipments` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = shipments.manufacturer_id) AND (om.role = ANY (ARRAY['mfr_admin'::text, 'mfr_qa'::text, 'platform_admin'::text])))))`
- `Manufacturers can insert shipments` INSERT to authenticated check `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Manufacturers can select their shipments` SELECT to authenticated using `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Retailers can select shipments to them` SELECT to authenticated using `(retailer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Retailers can view their incoming shipments` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = shipments.retailer_id) AND (om.role = ANY (ARRAY['corp_admin'::text, 'store_manager'::text, 'platform_admin'::text])))))`

## store_group_members

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `store_group_id` | uuid | not null |  |
| `store_id` | uuid | not null |  |

**Constraints**

- Links: `FOREIGN KEY (store_group_id) REFERENCES store_groups(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (store_group_id, store_id)`

**Policies**

- `corp_admin_manage_group_members` ALL to public using `(store_group_id IN ( SELECT store_groups.id
   FROM store_groups
  WHERE (store_groups.organisation_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE ((organisation_members.user_id = auth.uid()) AND (organisation_members.role = 'corp_admin'::text))))))`
- `regional_manager_read_group_members` SELECT to public using `(store_group_id IN ( SELECT organisation_members.store_group_id
   FROM organisation_members
  WHERE ((organisation_members.user_id = auth.uid()) AND (organisation_members.store_group_id IS NOT NULL))))`

## store_groups

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `name` | text | not null |  |
| `description` | text |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Policies**

- `corp_admin_manage_groups` ALL to public using `(organisation_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE ((organisation_members.user_id = auth.uid()) AND (organisation_members.role = 'corp_admin'::text))))`
- `regional_manager_read_group` SELECT to public using `(id IN ( SELECT organisation_members.store_group_id
   FROM organisation_members
  WHERE ((organisation_members.user_id = auth.uid()) AND (organisation_members.store_group_id IS NOT NULL))))`

## store_manager_stores

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `user_id` | uuid | not null |  |
| `store_id` | uuid | not null |  |
| `organisation_id` | uuid | not null |  |
| `assigned_at` | timestamp with time zone | not null | now() |
| `assigned_by` | uuid |  |  |

**Constraints**

- Links: `FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (user_id, store_id)`

**Other indexes**

- `CREATE INDEX store_manager_stores_user_idx ON public.store_manager_stores USING btree (user_id)`
- `CREATE INDEX store_manager_stores_store_idx ON public.store_manager_stores USING btree (store_id)`

**Policies**

- `store_manager_stores_corp_admin_all` ALL to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`
- `store_manager_stores_self_select` SELECT to public using `(user_id = auth.uid())`

## stores

Row security: on · Approximate rows: 19
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `created_at` | timestamp with time zone |  | now() |
| `name` | text | not null |  |
| `active` | boolean |  | true |
| `organisation_id` | uuid |  |  |
| `address` | text |  |  |
| `store_code` | text |  |  |
| `street_address` | text |  |  |
| `city` | text |  |  |
| `region` | text |  |  |
| `postal_code` | text |  |  |
| `country` | text |  |  |
| `phone` | text |  |  |
| `latitude` | double precision |  |  |
| `longitude` | double precision |  |  |
| `geocoded_at` | timestamp with time zone |  |  |
| `geocoding_source` | text |  |  |
| `external_code` | text |  |  |

**Constraints**

- Check: `CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)))`
- Check: `CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))))`
- Check: `CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))))`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE UNIQUE INDEX stores_org_name_uidx ON public.stores USING btree (organisation_id, lower(btrim(name)))`
- `CREATE INDEX stores_org_idx ON public.stores USING btree (organisation_id)`
- `CREATE INDEX stores_org_external_code_idx ON public.stores USING btree (organisation_id, external_code) WHERE (external_code IS NOT NULL)`

**Policies**

- `Admins and managers can manage stores` ALL to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = stores.organisation_id) AND (om.role = ANY (ARRAY['corp_admin'::text, 'store_manager'::text, 'platform_admin'::text])))))`
- `b20_stores_admin_write` ALL to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`
- `b20_stores_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `Members can view their org stores` SELECT to authenticated using `(EXISTS ( SELECT 1
   FROM organisation_members om
  WHERE ((om.user_id = auth.uid()) AND (om.organisation_id = stores.organisation_id))))`
- `b20_stores_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`

## supplier_connections

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `manufacturer_id` | uuid | not null |  |
| `supplier_id` | uuid | not null |  |
| `status` | text |  | 'pending'::text |
| `created_at` | timestamp with time zone |  | now() |
| `supplier_email` | text |  |  |
| `invited_by_name` | text |  |  |

**Constraints**

- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (supplier_id) REFERENCES organisations(id)`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (manufacturer_id, supplier_id)`

**Other indexes**

- `CREATE INDEX idx_supplier_connections_email ON public.supplier_connections USING btree (supplier_email)`

**Policies**

- `Manufacturers manage supplier connections` ALL to public using `(manufacturer_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Suppliers view their connections` SELECT to public using `(supplier_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## supplier_ingredients

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `supplier_org_id` | uuid | not null |  |
| `name` | text | not null |  |
| `barcode` | text |  |  |
| `category` | text |  |  |
| `unit` | text |  |  |
| `description` | text |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (supplier_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_supplier_ingredients_org ON public.supplier_ingredients USING btree (supplier_org_id)`

**Policies**

- `Suppliers manage own ingredients` ALL to public using `(supplier_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Manufacturers view linked supplier ingredients` SELECT to public using `(supplier_org_id IN ( SELECT supplier_manufacturer_links.supplier_org_id
   FROM supplier_manufacturer_links
  WHERE ((supplier_manufacturer_links.manufacturer_org_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) AND (supplier_manufacturer_links.status = 'active'::text))))`

## supplier_lot_codes

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `supplier_org_id` | uuid | not null |  |
| `ingredient_id` | uuid |  |  |
| `lot_code` | text | not null |  |
| `production_date` | date |  |  |
| `expiry_date` | date |  |  |
| `quantity` | numeric |  |  |
| `notes` | text |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (ingredient_id) REFERENCES supplier_ingredients(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (supplier_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_supplier_lot_codes_org ON public.supplier_lot_codes USING btree (supplier_org_id)`
- `CREATE INDEX idx_supplier_lot_codes_ingredient ON public.supplier_lot_codes USING btree (ingredient_id)`

**Policies**

- `Suppliers manage own lot codes` ALL to public using `(supplier_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Manufacturers view linked supplier lot codes` SELECT to public using `(supplier_org_id IN ( SELECT supplier_manufacturer_links.supplier_org_id
   FROM supplier_manufacturer_links
  WHERE ((supplier_manufacturer_links.manufacturer_org_id IN ( SELECT organisation_members.organisation_id
           FROM organisation_members
          WHERE (organisation_members.user_id = auth.uid()))) AND (supplier_manufacturer_links.status = 'active'::text))))`

## supplier_manufacturer_links

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `supplier_org_id` | uuid | not null |  |
| `manufacturer_org_id` | uuid | not null |  |
| `status` | text | not null | 'pending'::text |
| `invited_by` | uuid |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Check: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])))`
- Links: `FOREIGN KEY (invited_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (manufacturer_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (supplier_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (supplier_org_id, manufacturer_org_id)`

**Other indexes**

- `CREATE INDEX idx_supplier_links_mfr ON public.supplier_manufacturer_links USING btree (manufacturer_org_id)`
- `CREATE INDEX idx_supplier_links_supplier ON public.supplier_manufacturer_links USING btree (supplier_org_id)`

**Policies**

- `Manufacturers can create supplier links` INSERT to public check `(manufacturer_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Both sides view their links` SELECT to public using `((supplier_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))) OR (manufacturer_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid()))))`
- `Suppliers can update their link status` UPDATE to public using `(supplier_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## supplier_shipments

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `supplier_org_id` | uuid | not null |  |
| `ingredient_id` | uuid |  |  |
| `ingredient_name` | text |  |  |
| `manufacturer_org_id` | uuid | not null |  |
| `lot_code` | text | not null |  |
| `quantity` | numeric |  |  |
| `unit` | text |  | 'kg'::text |
| `shipped_at` | timestamp with time zone | not null |  |
| `reference` | text |  |  |
| `created_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (ingredient_id) REFERENCES supplier_ingredients(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (manufacturer_org_id) REFERENCES organisations(id)`
- Links: `FOREIGN KEY (supplier_org_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX idx_supplier_shipments_org ON public.supplier_shipments USING btree (supplier_org_id)`
- `CREATE INDEX idx_supplier_shipments_mfr ON public.supplier_shipments USING btree (manufacturer_org_id)`

**Policies**

- `Suppliers manage own shipments` ALL to public using `(supplier_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`
- `Manufacturers view incoming supplier shipments` SELECT to public using `(manufacturer_org_id IN ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())))`

## suppliers

Row security: on · Approximate rows: 0
Table access: authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `name` | text | not null |  |
| `phone` | text |  |  |
| `street_address` | text |  |  |
| `city` | text |  |  |
| `region` | text |  |  |
| `postal_code` | text |  |  |
| `country` | text | not null | 'US'::text |
| `gln` | text |  |  |
| `supplier_type` | text | not null | 'distributor'::text |
| `is_exempt_entity` | boolean | not null | false |
| `category_hints` | text[] |  |  |
| `seeded_from` | text |  |  |
| `active` | boolean | not null | true |
| `created_at` | timestamp with time zone | not null | now() |
| `created_by` | uuid |  | auth.uid() |
| `updated_at` | timestamp with time zone | not null | now() |

**Constraints**

- Check: `CHECK ((supplier_type = ANY (ARRAY['distributor'::text, 'manufacturer'::text, 'farm'::text, 'other'::text])))`
- Links: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Other indexes**

- `CREATE INDEX suppliers_org_active_idx ON public.suppliers USING btree (organisation_id, active)`
- `CREATE UNIQUE INDEX suppliers_org_name_uidx ON public.suppliers USING btree (organisation_id, lower(name))`

**Triggers**

- `suppliers_touch_updated_at`: BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION batchd_touch_updated_at()

**Policies**

- `b22_suppliers_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b22_suppliers_corp_admin_delete` DELETE to public using `batchd_is_corp_admin_of(organisation_id)`
- `b22_suppliers_member_insert` INSERT to public check `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b22_suppliers_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b22_suppliers_manager_update` UPDATE to public using `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))` check `(batchd_is_corp_admin_of(organisation_id) OR batchd_is_manager_of(organisation_id))`

## traceability_plans

Row security: on · Approximate rows: 0
Table access: authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `organisation_id` | uuid | not null |  |
| `version` | integer | not null |  |
| `content_json` | jsonb | not null |  |
| `rendered_html` | text |  |  |
| `generated_at` | timestamp with time zone | not null | now() |
| `generated_by` | text |  |  |
| `superseded_at` | timestamp with time zone |  |  |

**Constraints**

- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (organisation_id, version)`

**Other indexes**

- `CREATE INDEX traceability_plans_org_current_idx ON public.traceability_plans USING btree (organisation_id) WHERE (superseded_at IS NULL)`

**Policies**

- `b26_plans_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b26_plans_corp_admin_insert` INSERT to public check `batchd_is_corp_admin_of(organisation_id)`
- `b26_plans_member_select` SELECT to public using `(organisation_id IN ( SELECT batchd_my_active_org_ids() AS batchd_my_active_org_ids))`
- `b26_plans_corp_admin_update` UPDATE to public using `batchd_is_corp_admin_of(organisation_id)` check `batchd_is_corp_admin_of(organisation_id)`

## trading_partners

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `manufacturer_id` | uuid | not null |  |
| `retailer_id` | uuid | not null |  |
| `status` | text | not null | 'pending'::text |
| `invited_by` | uuid |  |  |
| `created_at` | timestamp with time zone | not null | now() |
| `share_scan_intelligence` | boolean | not null | false |

**Constraints**

- Check: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text])))`
- Links: `FOREIGN KEY (invited_by) REFERENCES auth.users(id)`
- Links: `FOREIGN KEY (manufacturer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Links: `FOREIGN KEY (retailer_id) REFERENCES organisations(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (manufacturer_id, retailer_id)`

**Policies**

- `Manufacturers can insert trading partners` INSERT to authenticated check `(manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`
- `Manufacturers can view their trading partners` SELECT to authenticated using `((manufacturer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1)) OR (retailer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1)))`
- `Retailers can update trading partner status` UPDATE to authenticated using `(retailer_id = ( SELECT organisation_members.organisation_id
   FROM organisation_members
  WHERE (organisation_members.user_id = auth.uid())
 LIMIT 1))`

## user_profiles

Row security: on · Approximate rows: 0
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null |  |
| `email` | text |  |  |
| `is_manager` | boolean |  | false |
| `updated_at` | timestamp with time zone |  | now() |

**Constraints**

- Links: `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Primary key: `PRIMARY KEY (id)`

**Triggers**

- `batchd_guard_profile_update`: BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION batchd_guard_profile_update()

**Policies**

- `b20_profiles_platform_admin` ALL to public using `batchd_is_platform_admin()` check `batchd_is_platform_admin()`
- `b20_profiles_own_insert` INSERT to public check `((id = auth.uid()) AND (COALESCE(is_manager, false) = false))`
- `b20_profiles_own_select` SELECT to public using `(id = auth.uid())`
- `b20_profiles_own_update` UPDATE to public using `(id = auth.uid())` check `(id = auth.uid())`

## user_settings

Row security: on · Approximate rows: 11
Table access: anon: select; authenticated: delete, insert, references, select, trigger, truncate, update; service_role: delete, insert, references, select, trigger, truncate, update

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | gen_random_uuid() |
| `user_id` | uuid |  |  |
| `recall_source` | text |  | 'both'::text |
| `created_at` | timestamp with time zone |  | now() |
| `updated_at` | timestamp with time zone |  | now() |
| `onboarding_done` | boolean |  | false |
| `recall_lookback_days` | integer |  | 180 |
| `recall_coordinator_name` | text |  |  |
| `recall_coordinator_contact` | text |  |  |
| `recall_coordinator_backup` | text |  |  |
| `region` | text |  | 'no'::text |
| `organisation_id` | uuid |  |  |
| `store_id` | uuid |  |  |
| `last_seen_at` | timestamp with time zone |  |  |
| `last_seen_app` | text |  |  |
| `language` | text |  |  |
| `date_format` | text |  |  |
| `notification_prefs` | jsonb |  | '{"recall_pushed": true, "complaint_filed": true, "drill_scheduled": true}'::jsonb |

**Constraints**

- Check: `CHECK (((date_format IS NULL) OR (date_format = ANY (ARRAY['auto'::text, 'us'::text, 'eu'::text]))))`
- Links: `FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE SET NULL`
- Links: `FOREIGN KEY (store_id) REFERENCES stores(id)`
- Links: `FOREIGN KEY (user_id) REFERENCES auth.users(id)`
- Primary key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (user_id)`

**Policies**

- `Users manage own settings` ALL to authenticated using `(user_id = auth.uid())` check `(user_id = auth.uid())`

# Views

## View products_public

Options: security_invoker=false

```sql
 SELECT id,
    barcode_normalized,
    name AS product_name,
    source,
    is_ftl,
    ftl_category,
    ftl_confirmed_source
   FROM products
  WHERE published = true AND barcode_normalized IS NOT NULL;
```

## View user_accessible_stores

Options: security_invoker=true

```sql
 SELECT DISTINCT s.id,
    s.created_at,
    s.name,
    s.active,
    s.organisation_id,
    s.address,
    s.store_code,
    om.user_id
   FROM stores s
     JOIN organisation_members om ON om.organisation_id = s.organisation_id
  WHERE om.role = 'corp_admin'::text OR om.role = 'store_manager'::text AND om.store_group_id IS NULL AND om.store_id = s.id OR om.role = 'store_manager'::text AND om.store_group_id IS NOT NULL AND (s.id IN ( SELECT store_group_members.store_id
           FROM store_group_members
          WHERE store_group_members.store_group_id = om.store_group_id));
```

# Functions

| Function | Returns | Security | Callable by |
|---|---|---|---|
| `accept_invitation(text,text,text,text,text,text)` | jsonb | definer | anon, authenticated, service_role |
| `batchd_bypass_guards_active()` | boolean | invoker | authenticated, service_role |
| `batchd_guard_member_insert()` | trigger | invoker | service_role |
| `batchd_guard_member_self_update()` | trigger | invoker | service_role |
| `batchd_guard_org_commercial_columns()` | trigger | invoker | service_role |
| `batchd_guard_profile_update()` | trigger | invoker | service_role |
| `batchd_is_corp_admin_of(uuid)` | boolean | definer | authenticated, service_role |
| `batchd_is_manager_of(uuid)` | boolean | definer | authenticated, service_role |
| `batchd_is_platform_admin()` | boolean | definer | authenticated, service_role |
| `batchd_my_active_org_ids()` | SETOF uuid | definer | authenticated, service_role |
| `batchd_my_partner_source_org_ids()` | SETOF uuid | definer | authenticated, service_role |
| `batchd_my_source_event_ids()` | SETOF uuid | definer | authenticated, service_role |
| `batchd_org_ai_enabled(uuid)` | boolean | definer | authenticated, service_role |
| `batchd_receiving_set_retention()` | trigger | invoker | service_role |
| `batchd_touch_updated_at()` | trigger | invoker | service_role |
| `batchd_user_is_corp_admin()` | boolean | definer | PUBLIC, anon, authenticated, service_role |
| `batchd_user_is_store_manager()` | boolean | definer | PUBLIC, anon, authenticated, service_role |
| `batchd_user_manages_store(uuid)` | boolean | invoker | PUBLIC, anon, authenticated, service_role |
| `batchd_user_org_id()` | uuid | definer | PUBLIC, anon, authenticated, service_role |
| `batchd_user_primary_store_id()` | uuid | invoker | PUBLIC, anon, authenticated, service_role |
| `batchd_user_role()` | text | definer | PUBLIC, anon, authenticated, service_role |
| `bootstrap_products_pending()` | TABLE(rows_staged_from_code_patterns integer, rows_staged_from_scans integer, rows_skipped_already_in_products integer, conflicts_flagged integer) | definer | service_role |
| `create_organisation(text,text,text,text)` | uuid | definer | service_role |
| `create_organisation_with_admin(text,text,text,text,text[])` | uuid | definer | anon, authenticated, service_role |
| `enforce_scan_immutability()` | trigger | invoker | service_role |
| `get_invitation_by_token(text)` | TABLE(email text, role text, organisation_id uuid, organisation_name text, store_name text, manager_store_ids uuid[], accepted boolean, expired boolean, full_name text, phone_number text, store_role text, employee_id text, hire_date date, region text) | definer | anon, authenticated, service_role |
| `get_invitation_store_names(text)` | text[] | definer | anon, authenticated, service_role |
| `get_my_organisation_ids()` | SETOF uuid | definer | PUBLIC, anon, authenticated, service_role |
| `get_org_member_emails(uuid)` | TABLE(user_id uuid, email text, full_name text) | definer | PUBLIC, authenticated, service_role |
| `get_retailer_emails(uuid)` | text[] | definer | service_role |
| `handle_new_user()` | trigger | definer | service_role |
| `log_scan_change()` | trigger | definer | service_role |
| `normalize_barcode(text)` | text | invoker | PUBLIC, anon, authenticated, service_role |
| `products_normalize_barcode_trigger()` | trigger | invoker | service_role |
| `promote_pending_to_products(uuid)` | uuid | definer | service_role |
| `promote_product_trust_tier_on_scan()` | trigger | definer | service_role |
| `push_recall(text,text,text,text,text,text,text,boolean)` | json | definer | service_role |
| `reject_pending(uuid,text)` | void | definer | service_role |
| `send_invitation(uuid,text,text,uuid)` | json | definer | authenticated, service_role |
| `sweep_recall_matches(uuid,uuid,integer)` | integer | definer | authenticated, service_role |
| `sync_recall_match_removal()` | trigger | definer | service_role |
| `trigger_recall_sweep()` | trigger | definer | service_role |

# Storage

- Bucket `scan-photos` (public links)

- `b32_scan_photos_member_insert` INSERT to authenticated check `((bucket_id = 'scan-photos'::text) AND ((storage.foldername(name))[1] = 'orgs'::text) AND ((storage.foldername(name))[2] IN ( SELECT "left"((o.o)::text, 8) AS "left"
   FROM batchd_my_active_org_ids() o(o))))`
- `b32_scan_photos_member_select` SELECT to authenticated using `((bucket_id = 'scan-photos'::text) AND ((storage.foldername(name))[1] = 'orgs'::text) AND ((storage.foldername(name))[2] IN ( SELECT "left"((o.o)::text, 8) AS "left"
   FROM batchd_my_active_org_ids() o(o))))`
- `b32_scan_photos_member_update` UPDATE to authenticated using `((bucket_id = 'scan-photos'::text) AND ((storage.foldername(name))[1] = 'orgs'::text) AND ((storage.foldername(name))[2] IN ( SELECT "left"((o.o)::text, 8) AS "left"
   FROM batchd_my_active_org_ids() o(o))))` check `((bucket_id = 'scan-photos'::text) AND ((storage.foldername(name))[1] = 'orgs'::text) AND ((storage.foldername(name))[2] IN ( SELECT "left"((o.o)::text, 8) AS "left"
   FROM batchd_my_active_org_ids() o(o))))`
