# Vidomo

Fatia vertical: prédio 3D no celular cujas unidades mudam de cor em tempo real quando o
status muda no banco. Contexto e regras do projeto em [CLAUDE.md](CLAUDE.md).

> README em construção — completado na Etapa 7.

## Pré-requisitos

- Node 22+ e pnpm 10 (`npm i -g pnpm@10`)
- Docker Desktop aberto (o Supabase local roda em containers)
- O Supabase CLI vem como dependência do projeto: `pnpm exec supabase …`

## Subir o ambiente

```bash
pnpm install
pnpm db:start   # sobe o Supabase local (1ª vez baixa as imagens)
pnpm db:reset   # aplica migrations + seed
```

`pnpm exec supabase status` mostra URL, chaves e o Studio (http://127.0.0.1:54323).
Copie `.env.example` para `apps/web/.env.local` e preencha com esses valores.

## Usuários de desenvolvimento (somente local)

| Organização         | E-mail               | Senha            | Papel |
| ------------------- | -------------------- | ---------------- | ----- |
| Construtora Exemplo | `admin@exemplo.test` | `vidomo-dev-123` | admin |
| Construtora Teste   | `admin@teste.test`   | `vidomo-dev-123` | admin |

Dados do seed:

- **Residencial Vista** (`residencial-vista`, publicado) — Construtora Exemplo, torre TA,
  10 andares × 4 unidades (101–104 … 1001–1004), plantas Tipo A/B alternadas, os 5 status.
- **Residencial Teste** (`residencial-teste`, rascunho) — Construtora Teste, 4 unidades.

## Prédio de teste (GLB)

```bash
pnpm model:generate   # gera scripts/out/residencial-vista-test.glb (Meshopt)
pnpm model:validate   # compara objetos do GLB × unidades/andares do banco + peso
pnpm model:upload     # valida e envia ao bucket models (caminho = developments.model_path)
```

`pnpm db:reset` apaga os objetos do Storage: depois de um reset, rode `pnpm model:upload` de novo.
`model:validate` aceita outro arquivo e empreendimento: `pnpm model:validate caminho.glb --slug outro`.

## Visualizador isolado (`packages/viewer`)

```bash
pnpm model:generate                     # o exemplo usa scripts/out/residencial-vista-test.glb
pnpm --filter @vidomo/viewer example    # http://localhost:5174 e na rede local (porta 5174)
```

Exemplo com status falsos: tocar numa unidade seleciona; "Mudar um status" e "Automático"
trocam cores sem recarregar o modelo. `?model=<url>` carrega outro GLB.

**Celular na rede local:** abra `http://<IP-do-PC>:5174` (o Vite lista os endereços ao subir).
No Windows, a porta precisa estar liberada no firewall. Num PowerShell **como administrador**:

```powershell
New-NetFirewallRule -DisplayName "Vidomo dev (5174, 3000, 54321)" -Direction Inbound -Protocol TCP -LocalPort 5174,3000,54321 -RemoteAddress LocalSubnet -Action Allow -Profile Private,Public
```

Para remover depois: `Remove-NetFirewallRule -DisplayName "Vidomo dev (5174, 3000, 54321)"`.

## Página pública da demo

```bash
pnpm dev   # Next em http://localhost:3000 e na rede local (porta 3000)
```

Abra `/e/residencial-vista`. O HTML já chega com nome, legenda com contagens e um
placeholder; o three.js e o GLB baixam depois (Viewer com `next/dynamic`, sem SSR; GLB com
preload). O status chega por Broadcast (`development:<slug>`) e a página relê tudo pela
função pública ao conectar/reconectar, ao voltar do segundo plano e quando a rede volta.

**No celular**, `127.0.0.1` é o próprio celular: em `apps/web/.env.local` use o IP da
máquina em `NEXT_PUBLIC_SUPABASE_URL` (ex.: `http://192.168.0.10:54321`) e libere também a
porta **54321** no firewall (já incluída na regra acima).

## Painel mínimo de status (teste de ponta a ponta)

1. `pnpm dev` e abra `http://localhost:3000/painel/dev-status` (pede login).
2. Entre com um usuário de desenvolvimento (tabela acima). A lista mostra só as unidades
   da organização do usuário (RLS).
3. Abra a demo no celular: `http://<IP-do-PC>:3000/e/residencial-vista`.
4. Mude um status no painel: a cor muda no celular em menos de 3 s. A mudança passa por
   `set_unit_status` e fica em `unit_status_history` com o usuário e o motivo.

O painel também se atualiza sozinho quando outro usuário muda um status (`postgres_changes`).

## Testes

```bash
pnpm test:unit  # testes que não precisam de banco
pnpm test:db    # isolamento multiempresa e Realtime (Supabase local rodando)
pnpm test       # tudo
```

## Banco — visão rápida

- Migrations em `supabase/migrations`, seed em `supabase/seed.sql`.
- RLS em todas as tabelas; `anon` não tem acesso direto a nenhuma tabela.
- `units.status` só muda por `set_unit_status(p_unit_id, p_new_status, p_reason)`.
- `unit_status_history` é preenchida por trigger e não aceita UPDATE/DELETE/TRUNCATE.
- Leitura pública: `public_development(p_slug)` e `public_development_units(p_slug)` (sem preço).
- Realtime:
  - painel (autenticado): `postgres_changes` em `units`, filtrado pela RLS;
  - página pública: Broadcast privado no tópico `development:<slug>` com
    `{object_key, status}`. Só o trigger do banco publica; o anônimo só recebe, e só de
    empreendimento publicado.
