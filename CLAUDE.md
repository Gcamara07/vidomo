# Vidomo — contexto do projeto

Vidomo ("eu vejo a casa", do latim video + domus) é uma plataforma SaaS multiempresa para incorporadoras pequenas e médias: o comprador explora o empreendimento em 3D, vê a disponibilidade das unidades em tempo real e envia interesse; o vendedor apresenta e reserva; o admin cadastra e controla status.

Documento de referência: PRD — Vidomo (MVP). Em caso de dúvida sobre comportamento, pergunte antes de inventar requisito.

## Stack

- Monorepo com pnpm workspaces
  - `apps/web`: Next.js (App Router), React, TypeScript — portal público, painel comercial, admin e quiosque
  - `packages/viewer`: visualizador 3D em React Three Fiber + drei — NÃO importa Supabase nem conhece o banco
- Supabase: Postgres, Auth, RLS, Realtime, Storage, pg_cron
- Migrations em `supabase/migrations` (SQL puro, versionado)
- Testes: Vitest; testes de RLS rodam contra o Supabase local
- Otimização 3D: gltf-transform (Meshopt + KTX2)
- Panoramas 360°: Photo Sphere Viewer + plugin de tour virtual (mesma versão de `three` do viewer)

## Regras inegociáveis

1. **Multiempresa:** toda tabela de dados de cliente tem `organization_id` e política RLS. Nenhuma leitura ou escrita cruzada entre organizações. O teste de acesso cruzado precisa passar sempre.
2. **Status só por função no banco:** o front nunca faz UPDATE direto em `units.status`. Usa as RPCs `set_unit_status` / `reserve_unit`, que validam papel, travam a linha (`SELECT … FOR UPDATE`) e gravam histórico.
3. **Histórico imutável:** `unit_status_history` preenchida por trigger, sem UPDATE/DELETE.
4. **Comprador anônimo** só lê empreendimentos publicados e campos públicos, via view/RPC dedicada. Preço segue `price_display` (oculto | a partir de | exato); unidade vendida nunca mostra preço.
5. **Viewer desacoplado:** entrada = manifesto da cena + mapa de status; saída = eventos (`onSelectUnit`, `onSelectFloor`, `onModeChange`). Estado serializável (modo, seleção, câmera).
6. **Nenhum código condicional por cliente.** Toda diferença vem de configuração (branding em jsonb).
7. **Arquivos 3D** sempre acessados via `getAssetUrl()`, nunca URL montada à mão.
8. Etapas pequenas e verificáveis. Ao terminar cada etapa, pare, resuma o que fez e como testar.

## Convenção de nomes 3D (Blender / GLB)

| Objeto                      | Formato                              | Exemplo               |
| --------------------------- | ------------------------------------ | --------------------- |
| Unidade (volume de seleção) | `UNIT__<torre>__F<andar>__U<código>` | `UNIT__TA__F08__U802` |
| Andar                       | `FLOOR__<torre>__F<andar>`           | `FLOOR__TA__F08`      |
| Torre                       | `TOWER__<torre>`                     | `TOWER__TA`           |
| Área comum                  | `AMENITY__<nome>`                    | `AMENITY__PISCINA`    |
| Só visual                   | `VIS__<descrição>`                   | `VIS__FACHADA_NORTE`  |

`object_key` no banco = nome sem o prefixo de tipo (ex.: `TA__F08__U802`). Único por empreendimento.

## Status das unidades (cores da marca)

Todos com contorno Musgo #23382F 1px.

| Status                                | Valor no banco | Visual                                      |
| ------------------------------------- | -------------- | ------------------------------------------- |
| Disponível                            | `available`    | Verde Broto #8CCB8F, sólido                 |
| Reservado                             | `reserved`     | Hachura 45° #C99A2E sobre #F3E3B8           |
| Em negociação                         | `negotiating`  | Hachura −45° Sálvia #3E5A4D sobre #DCE5DF   |
| Vendido                               | `sold`         | Terracota #C97A6C, sólido                   |
| Indisponível                          | `unavailable`  | Areia #D6CFC1, sólido                       |
| Selecionada (interação, não é status) | —              | Latão #B08D57 sólido + contorno Nanquim 3px |

## Marca (tokens)

- Cores: Musgo #23382F (primária) · Sálvia #3E5A4D · Latão #B08D57 · Latão Profundo #8A6A38 · Latão Claro #C9A86E · Papel #F3EFE7 · Linho #E6DFD2 · Areia #D6CFC1 · Cinza quente #6B6A63 · Nanquim #1A2420 · Erro #B23A2E
- Tipografia: Fraunces (títulos, itálico para ênfase) · Inter (texto e UI) · IBM Plex Mono (medidas, rótulos, códigos de unidade)
- Visualizador: fundo papel com grade milimetrada, edifício em traço técnico, unidades em cor chapada (sem fotorrealismo no 3D em tempo real)
- Quiosque: orientação paisagem

## Limites de desempenho

- Modo edifício interativo em até 5 s em 4G num Samsung Galaxy A de entrada
- 30 fps ou mais nesse aparelho
- Cena do edifício até 10 MB comprimida; texturas até 2K em KTX2
- Mudança de status visível em até 3 s em todos os clientes abertos
