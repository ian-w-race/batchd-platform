-- Batch'd pre-flight diagnostic 2 of 2. READ-ONLY: changes nothing.
-- Shows the send_invitation function, which is not in the repo and which
-- Claude has never seen. Copy the whole result (especially the long
-- "body" cell) and send it back.
SELECT p.proname                              AS function_name,
       pg_get_function_arguments(p.oid)       AS arguments,
       p.prosecdef                            AS is_security_definer,
       p.proconfig                            AS settings,
       p.prosrc                               AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'send_invitation';
