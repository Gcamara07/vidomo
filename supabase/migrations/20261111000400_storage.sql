-- Bucket público dos modelos 3D. O app nunca monta a URL à mão: usa getAssetUrl() (regra 7).
-- Leitura pública (bucket public = true); upload só com service_role (script da Etapa 3).
-- TODO(sigilo pré-lançamento): o bucket é público, então o GLB de um empreendimento em
-- rascunho fica acessível a quem souber o caminho. Para clientes que exigirem sigilo antes
-- do lançamento, servir modelos de rascunho por URL assinada (bucket privado + getAssetUrl()
-- pedindo a URL ao servidor).
-- TODO(arquivos por organização): prefixar caminhos por organização quando houver upload pelo admin.
insert into storage.buckets (id, name, public)
values ('models', 'models', true)
on conflict (id) do nothing;
