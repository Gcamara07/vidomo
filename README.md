# Vidomo

Fatia vertical da Vidomo: um prédio 3D no celular cujas unidades mudam de cor em tempo
real quando o status muda no banco. Contexto, regras e marca em [CLAUDE.md](CLAUDE.md).

```
apps/web          Next.js 16 (App Router): /e/[slug] (público), /login, /painel/dev-status
packages/viewer   <Viewer> em React Three Fiber + drei (não conhece o banco) + exemplo isolado
supabase/         migrations SQL, seed, testes de RLS/Realtime (Vitest)
scripts/          gerar/validar/enviar o GLB de teste, medir a demo
```

## 1. Pré-requisitos

- Node 22+ e pnpm 10 (`npm i -g pnpm@10`)
- Docker Desktop aberto (o Supabase local roda em containers)
- Chrome ou Edge instalado (só para `pnpm measure`)
- O Supabase CLI vem como dependência do projeto: `pnpm exec supabase …`

## 2. Subir o ambiente

```bash
pnpm install
pnpm db:start        # sobe o Supabase local (na 1ª vez baixa as imagens)
pnpm db:reset        # aplica migrations + seed
pnpm model:compress modelos/residencial-vista-leve.glb       # Meshopt → scripts/out/
pnpm model:compress modelos/residencial-vista-detalhes.glb
pnpm model:upload    # camada leve → developments.model_path
pnpm model:upload scripts/out/residencial-vista-detalhes.glb --layer detail
```

Crie `apps/web/.env.local` a partir do [.env.example](.env.example) com os valores de
`pnpm exec supabase status` (URL da API e chave anon). A service_role não vai para o app.

```bash
pnpm dev             # http://localhost:3000/e/residencial-vista
```

`pnpm db:reset` apaga os objetos do Storage: depois de um reset, rode os dois
`pnpm model:upload` de novo. O Studio fica em http://127.0.0.1:54323.

### Usuários de desenvolvimento (somente local)

| Organização         | E-mail               | Senha            | Papel |
| ------------------- | -------------------- | ---------------- | ----- |
| Construtora Exemplo | `admin@exemplo.test` | `vidomo-dev-123` | admin |
| Construtora Teste   | `admin@teste.test`   | `vidomo-dev-123` | admin |

- **Residencial Vista** (`residencial-vista`, publicado) — Construtora Exemplo, torre TA,
  10 andares × 4 unidades (101–104 … 1001–1004), os 5 status. Finais 1 e 3: Tipo A
  (2 dorms, 58 m²); finais 2 e 4: Tipo B (3 dorms, 75 m²) — iguais ao modelo do Blender.
- **Residencial Teste** (`residencial-teste`, rascunho) — Construtora Teste, 4 unidades.

## 3. Modelos 3D (GLB) e as duas camadas

### Modelo real (Blender)

- `modelos/residencial-vista-leve.glb` (camada 1) e `modelos/residencial-vista-detalhes.glb`
  (camada 2: esquadrias, varandas, guarda-corpos, hall, platibanda, terreno, rua, pisos,
  portaria, árvores, jardins e as áreas comuns `AMENITY__PISCINA`, `AMENITY__GOURMET`,
  `AMENITY__ACADEMIA`) — exportados do Blender, vão para o git. Os `.blend` ficam fora
  (`modelos/*.blend`).
- Os detalhes usam as cores do próprio GLB, chapadas (sem luz), com o contorno técnico. A
  cor precisa estar no **Base Color do Principled BSDF**: a cor de "Viewport Display"
  (modo Solid) não é exportada. Digite a cor no campo **Hex** do seletor (que é sRGB); os
  campos R/G/B são lineares, e valores sRGB digitados neles saem mais claros no GLB.
- `AMENITY__` é aceito na camada de detalhes e, por enquanto, só visual (o validador lista
  as áreas comuns encontradas). TODO: toque para abrir o panorama 360°.
- `pnpm model:compress <arquivo.glb>` aplica o pipeline (dedup, quantização, Meshopt) e
  grava em `scripts/out/` (reproduzível, fora do git).
- `pnpm model:validate` e `pnpm model:upload` usam `scripts/out/residencial-vista-leve.glb`
  por padrão; o upload vai para `developments.model_path`.

### Prédio de teste (caixas) e simulações

O viewer carrega o prédio em duas camadas:

| Camada                  | Coluna                           | Conteúdo                             | Papel                                                                       |
| ----------------------- | -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| 1 — leve (obrigatória)  | `developments.model_path`        | volumes `UNIT__`, lajes, casca       | torna o prédio interativo; meta de até **2 MB**                             |
| 2 — detalhes (opcional) | `developments.detail_model_path` | fachada, varandas, entorno (`VIS__`) | carregada depois, sem bloquear; se falhar, o prédio segue só com a camada 1 |

```bash
pnpm model:generate   # caixas: torre, 10 lajes, 40 unidades → scripts/out/residencial-vista-test.glb
pnpm model:validate scripts/out/residencial-vista-test.glb
pnpm model:upload scripts/out/residencial-vista-test.glb   # troca o modelo real pelas caixas
```

- `pnpm model:validate caminho.glb --slug outro` valida outro arquivo; sai com código 1 se
  houver problema. Acima de **2 MB** no modelo leve, alerta (sem reprovar); acima de 10 MB, reprova.
- `--layer detail` valida/envia o GLB de detalhes (não exige unidades; avisa se tiver `UNIT__`).
- `pnpm model:generate --layer detail` gera varandas e guarda-corpos de teste.
- `--pad-mb N` acrescenta uma malha plana "pesada" até ~N MB, para simular o peso de um
  modelo real (ex.: `--out scripts/out/residencial-vista-1.5mb.glb --pad-mb 1.5`).

## 4. Testes

```bash
pnpm test:unit  # sem banco: viewer, scripts, web
pnpm test:db    # isolamento multiempresa, acesso anônimo, histórico e Realtime
pnpm test       # tudo (precisa do Supabase local rodando)
pnpm lint && pnpm typecheck
```

O teste de isolamento (`supabase/tests/isolation.test.ts`) roda contra o Supabase local:
o admin da organização B tenta ler e alterar unidades da A por SELECT/UPDATE/DELETE/INSERT
diretos e pela RPC, e falha sempre; o anônimo só lê pela função pública.

## 5. Teste de ponta a ponta no celular

### Rede local (recomendado)

1. Descubra o IP do PC na rede (`ipconfig`), ex.: `192.168.0.10`.
2. Em `apps/web/.env.local`, use esse IP na URL do Supabase — no celular, `127.0.0.1`
   é o próprio celular:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://192.168.0.10:54321
   ```
3. No Windows, libere as portas no firewall (PowerShell **como administrador**):
   ```powershell
   New-NetFirewallRule -DisplayName "Vidomo dev (5174, 3000, 54321)" -Direction Inbound -Protocol TCP -LocalPort 5174,3000,54321 -RemoteAddress LocalSubnet -Action Allow -Profile Private,Public
   ```
   Para remover depois: `Remove-NetFirewallRule -DisplayName "Vidomo dev (5174, 3000, 54321)"`.
4. `pnpm dev` (o Next escuta na rede) e, com o celular na mesma rede, abra
   `http://192.168.0.10:3000/e/residencial-vista`.
5. No PC, abra `http://localhost:3000/painel/dev-status`, entre com `admin@exemplo.test`
   e mude um status: a cor muda no celular em menos de 3 s. A mudança passa por
   `set_unit_status` e fica em `unit_status_history` com o usuário e o motivo.

### Túnel (celular fora da rede)

Funciona com qualquer túnel HTTP (ex.: `cloudflared tunnel --url http://localhost:3000`),
mas são **dois** túneis: um para o Next (3000) e outro para o Supabase (54321), porque o
navegador fala direto com o Supabase (GLB, RPC e WebSocket do Realtime). Use a URL pública
do túnel do Supabase em `NEXT_PUBLIC_SUPABASE_URL` e reinicie o `pnpm dev`. Não exponha o
túnel do Supabase por mais tempo que o teste: ele dá acesso à API local.

### Visualizador isolado

```bash
pnpm --filter @vidomo/viewer example   # http://localhost:5174 e na rede local
```

Status falsos, sem Supabase: tocar seleciona; "Mudar um status" e "Automático" trocam cores
sem recarregar o modelo. `?model=<url>` carrega outro GLB.

## 6. Medições (build de produção, 4G lento)

```bash
pnpm --filter @vidomo/web build
pnpm --filter @vidomo/web exec next start -p 3100
pnpm measure            # outra aba; --runs 5, --network fast4g, --url …, --browser <exe>
```

Usa o Chrome/Edge instalado e aplica, pelo protocolo do DevTools, o mesmo perfil "Slow 4G"
do menu de throttling (~1,44 Mbit/s, 562 ms de latência; `--network fast4g` usa o "Fast 4G"),
cache desligado e tela 360×800 @2x. Mede FCP, tempo até o prédio ficar interativo
(`vidomo:viewer-ready`), até os detalhes entrarem (`vidomo:detail-ready`), JS da página, do
viewer e do supabase-js (gzip), GLBs e fps girando o prédio. A GPU é a do PC.

**fps no celular:** abra a demo com `?debug=1` (ex.: `http://<IP>:3000/e/residencial-vista?debug=1`).
Aparece um contador com fps, média e mínimo enquanto o prédio gira, tempos até interativo e
detalhes, draw calls, triângulos e a GPU. O viewer só desenha quando algo muda: gire com o
dedo ou toque em "Girar sozinho".

**Simular um modelo pesado:**

```bash
pnpm model:generate --out scripts/out/residencial-vista-1.5mb.glb --pad-mb 1.5
pnpm model:generate --layer detail --pad-mb 4
docker exec supabase_db_vidomo psql -U postgres -c "update developments set detail_model_path='residencial-vista/residencial-vista-test-detalhes.glb' where slug='residencial-vista'"
pnpm model:upload scripts/out/residencial-vista-1.5mb.glb
pnpm model:upload scripts/out/residencial-vista-test-detalhes.glb --layer detail
pnpm measure
pnpm db:reset && pnpm model:upload   # volta ao modelo real
```

## 7. Ambiente de demonstração

|                     | Onde                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| Demo pública        | https://vidomo.vercel.app/e/residencial-vista (a raiz `/` redireciona)  |
| Painel de status    | https://vidomo.vercel.app/painel/dev-status                             |
| Front (Vercel)      | projeto com root `apps/web`, funções em `iad1` (`apps/web/vercel.json`) |
| Supabase            | projeto `vidomo`, ref. `msqdndtgpjoiipxwkwno`, região us-east-1         |
| Referência da marca | `/dev/marca` (rota interna, `noindex`)                                  |

**Sem dados de produção**: só a Construtora Exemplo e o Residencial Vista.

> ⏸️ **O projeto gratuito do Supabase pausa após 7 dias sem uso.** Pausado, a demo abre
> sem dados e sem 3D. Para reativar: painel do Supabase → projeto → **Restore project**
> (leva alguns minutos; dados e arquivos são mantidos). Antes de uma apresentação, abra a
> demo uma vez para garantir que está ativa.

> ⚠️ **Nunca rode `supabase db reset --remote`**: ele aplicaria o `supabase/seed.sql` de
> desenvolvimento (Construtora Teste e senha fraca `vidomo-dev-123`). No remoto usa-se só
> `supabase/demo-seed.sql`.

### Auth e usuários

- **Cadastro público desligado** (Authentication → Sign In / Providers → "Allow new users to
  sign up" = off). Ninguém cria conta pela API pública; o login por e-mail e senha de
  usuários existentes continua funcionando (o bloqueio vale só para cadastro novo).
- Usuários da demo são criados **só** pelo `pnpm demo:admin`, que usa a API de admin do
  Auth (não afetada pelo bloqueio de cadastro), cria o usuário com e-mail já confirmado,
  gera uma senha forte de 24 caracteres, mostra-a **uma vez** no terminal (não grava em
  arquivo) e vincula o usuário como admin da Construtora Exemplo.

  ```bash
  pnpm demo:admin --email voce@exemplo.com            # cria
  pnpm demo:admin --email voce@exemplo.com --reset    # gera nova senha
  ```

  Precisa de `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (chave **secret** do
  projeto: `pnpm exec supabase projects api-keys --project-ref <ref> --reveal`) só no
  terminal. A secret nunca vai para a Vercel nem para arquivo versionado.

- **Proteção contra senhas vazadas** (HaveIBeenPwned) é do plano Pro: desligada por enquanto.
  As senhas da demo são geradas aleatoriamente, o que cobre o risco nesta fase.
- Conferir a configuração (público, sem segredo):
  `curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <publishable>"` →
  `"disable_signup": true`.

### Pré-requisito: CLI ligado ao projeto

No seu terminal (a senha do banco vai direto no prompt do CLI, nunca em arquivo):

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref msqdndtgpjoiipxwkwno
```

Os comandos de escrita no remoto pedem confirmação (`--yes`). Para scripts que precisam da
URL e das chaves, carregue-as só na sessão do terminal (Git Bash):

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://msqdndtgpjoiipxwkwno.supabase.co
pnpm exec supabase projects api-keys --project-ref msqdndtgpjoiipxwkwno --reveal
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<sb_publishable_…>
export SUPABASE_SERVICE_ROLE_KEY=<sb_secret_…>     # só no terminal; nunca na Vercel
```

### Reaplicar migrations

```bash
pnpm exec supabase db push --remote --dry-run   # lista o que falta; "seeds" deve vir vazio
pnpm exec supabase db push --remote             # aplica (pede confirmação)
```

Conferir que o remoto tem as mesmas proteções do local (RLS, políticas, funções,
trigger de Broadcast, tópico privado, bucket, privilégios) — as duas saídas devem ser iguais:

```bash
pnpm exec supabase db query --read-only -f supabase/checks/security-catalog.sql
pnpm exec supabase db query --remote --read-only -f supabase/checks/security-catalog.sql
```

### Dados da demo e admin

```bash
pnpm exec supabase db query --remote -f supabase/demo-seed.sql   # idempotente
pnpm demo:admin --email voce@exemplo.com                          # senha mostrada uma vez
```

### Modelos 3D

```bash
pnpm model:compress modelos/residencial-vista-leve.glb
pnpm model:compress modelos/residencial-vista-detalhes.glb
pnpm model:upload                                                   # camada leve
pnpm model:upload scripts/out/residencial-vista-detalhes.glb --layer detail
```

O upload valida o GLB contra as unidades do remoto antes de enviar.

### Testes contra o remoto

```bash
pnpm test:remote
```

Leitura anônima pela função pública, anônimo sem acesso às tabelas, GLBs públicos, cliente
sem publicar no tópico e Broadcast chegando em até 3 s. O teste de Broadcast troca o status
da unidade 1004 e o restaura (deixa 2 linhas no histórico, que é imutável); sem
`SUPABASE_SERVICE_ROLE_KEY` ele é pulado. Os testes que criam e apagam dados ficam só no
local (`pnpm test:db`).

### Deploy na Vercel

- Projeto ligado ao repositório `Gcamara07/vidomo`, **Root Directory `apps/web`**,
  framework Next.js, install/build padrão (pnpm pelo `pnpm-lock.yaml`), com "Include files
  outside the root directory" ligado (precisa do `packages/viewer`).
- Variáveis (Production e Preview): `NEXT_PUBLIC_SUPABASE_URL` e
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (chave **publishable**). **A secret não vai para a Vercel.**
- Região das funções: `iad1`, perto do banco em us-east-1 (`apps/web/vercel.json`).
- Deploy: cada push no `main` gera um deploy de produção.
- Supabase → Authentication → URL Configuration: Site URL `https://vidomo.vercel.app` e o
  mesmo domínio nas Redirect URLs. Ajuste pelo painel: `supabase config push` enviaria o
  `config.toml` local inteiro (e religaria o cadastro público).

### Medir a demo publicada

```bash
pnpm measure --network fast4g --url https://vidomo.vercel.app/e/residencial-vista
```

## 8. Como funciona (resumo)

- **Banco** (`supabase/migrations`): toda tabela de cliente tem `organization_id` e RLS;
  FKs compostas impedem apontar para outra organização. `anon` não tem acesso direto a
  nenhuma tabela.
- **Status**: `units.status` não tem GRANT de UPDATE; só muda por
  `set_unit_status(p_unit_id, p_new_status, p_reason)`, que valida papel, trava a linha
  (`FOR UPDATE`) e grava `unit_status_history` por trigger (imutável).
- **Leitura pública**: `public_development(slug)` e `public_development_units(slug)` — só
  empreendimento publicado, sem preço.
- **Realtime**: a página pública assina o Broadcast privado `development:<slug>` (só o
  trigger publica `{object_key, status}`; o anônimo só recebe) e relê tudo ao
  conectar/reconectar, ao voltar do segundo plano e quando a rede volta. O painel usa
  `postgres_changes` em `units`, filtrado pela RLS.
- **Página pública**: o HTML já traz nome, legenda com contagens e um placeholder. O
  chunk do three.js é pré-carregado em paralelo ao JS da página (o `<Viewer>` só monta no
  navegador), o GLB leve também; o de detalhes só depois do prédio interativo. O supabase-js
  (tempo real) é importado sob demanda e conecta depois que o prédio fica interativo (ou em
  6 s); as fontes pré-carregadas são só as da primeira tela.
- **Arquivos 3D**: sempre via `getAssetUrl()` (bucket público `models`).

Fora desta fatia (com TODOs no código): leads, reservas com prazo (`reserve_unit`),
quiosque, panoramas 360°, admin completo, subdomínios e tema por organização, regras finas
de transição de status (PRD 6.1), preço conforme `price_display`, URLs assinadas para
modelos de rascunho.
