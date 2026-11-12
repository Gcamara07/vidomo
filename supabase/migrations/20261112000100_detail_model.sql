-- Carregamento em duas camadas:
--   model_path         GLB leve obrigatório (volumes das unidades, lajes, casca; até 2 MB)
--   detail_model_path  GLB de detalhes opcional, carregado depois sem bloquear a interação

alter table public.developments add column detail_model_path text;

comment on column public.developments.model_path is
  'GLB leve obrigatório (camada 1): torna o prédio interativo. Meta: até 2 MB.';
comment on column public.developments.detail_model_path is
  'GLB de detalhes opcional (camada 2): só visual, carregado depois da camada 1.';

-- O tipo de retorno mudou: recria a função pública.
drop function public.public_development(text);

create function public.public_development(p_slug text)
returns table (
  slug text,
  name text,
  model_path text,
  detail_model_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.slug, d.name, d.model_path, d.detail_model_path
  from public.developments d
  where d.slug = p_slug
    and d.status = 'published';
$$;

revoke all on function public.public_development(text) from public;
grant execute on function public.public_development(text) to anon, authenticated;
