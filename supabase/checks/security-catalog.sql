-- Catálogo de segurança, para comparar ambientes (local × remoto):
--   pnpm exec supabase db query --read-only -f supabase/checks/security-catalog.sql
--   pnpm exec supabase db query --remote --read-only -f supabase/checks/security-catalog.sql
-- Somente leitura. Cada linha: categoria | objeto | detalhe.
select item from (
  -- RLS ligado em todas as tabelas de public
  select 'rls | ' || c.relname || ' | ' || c.relrowsecurity::text as item
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  -- Políticas (public e realtime.messages)
  select 'policy | ' || schemaname || '.' || tablename || ' | ' || policyname || ' ' || cmd
         || ' ' || array_to_string(roles, ',')
  from pg_policies where schemaname in ('public', 'realtime', 'storage')
    and (schemaname <> 'storage' or policyname not like 'objects%')
  union all
  -- Funções do app: security definer e quem executa
  select 'function | ' || n.nspname || '.' || p.proname || ' | definer=' || p.prosecdef
         || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
  union all
  -- Triggers do app
  select 'trigger | ' || c.relname || ' | ' || t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and (n.nspname = 'public' or t.tgname = 'on_auth_user_created')
  union all
  -- Publicação do Realtime
  select 'publication | supabase_realtime | ' || schemaname || '.' || tablename
  from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  -- Buckets
  select 'bucket | ' || id || ' | public=' || public from storage.buckets
  union all
  -- Privilégios por has_*_privilege, não por information_schema: no remoto o CLI consulta
  -- como supabase_read_only_user, e o information_schema esconde os grants de papéis dos
  -- quais ele não é membro (anon, authenticated).
  -- anon não acessa tabela nenhuma
  select 'anon-table-privileges | public | '
         || coalesce(string_agg(c.relname || ':' || pr.p, ',' order by c.relname, pr.p), 'nenhum')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(p)
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    and has_table_privilege('anon', c.oid, pr.p)
  union all
  -- Schema private: nenhuma tabela acessível por anon/authenticated (leads: chaves, antispam)
  select 'private-table-privileges | anon,authenticated | '
         || coalesce(string_agg(r.role || ':' || c.relname || ':' || pr.p, ','
                                order by r.role, c.relname, pr.p), 'nenhum')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon', 'authenticated']) r(role)
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(p)
  where n.nspname = 'private' and c.relkind in ('r', 'v', 'm', 'p')
    and has_table_privilege(r.role, c.oid, pr.p)
  union all
  -- Leads: colunas que o admin pode editar direto (o segredo fica no Vault)
  select 'column-privilege | organization_settings | authenticated update='
         || coalesce(string_agg(a.attname, ',' order by a.attname), 'nenhuma')
  from pg_attribute a
  where a.attrelid = 'public.organization_settings'::regclass and a.attnum > 0
    and not a.attisdropped
    and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  union all
  -- units.status sem UPDATE para authenticated (regra 2)
  select 'column-privilege | units.status | authenticated update='
         || has_column_privilege('authenticated', 'public.units', 'status', 'UPDATE')
  union all
  -- Colunas novas
  select 'column | developments.detail_model_path | '
         || exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'developments'
                      and column_name = 'detail_model_path')
) s
order by item;
