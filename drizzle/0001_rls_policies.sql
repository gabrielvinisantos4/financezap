-- Row Level Security: isolamento de dados financeiros por cliente no próprio banco.
-- A aplicação define `app.user_id` (withUser) ou `app.bypass_rls` (withSystem)
-- por transação. Sem nenhum dos dois, as tabelas abaixo não retornam nada.
-- FORCE garante que nem o dono das tabelas escape da política
-- (o usuário de banco da aplicação NÃO deve ser superusuário).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','categories','transactions','transaction_history',
                           'recurring_rules','pending_actions','conversation_turns']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR user_id = app_current_user_id()) '
      'WITH CHECK (app_rls_bypass() OR user_id = app_current_user_id())', t);
  END LOOP;
END $$;
