# Vidomo

Fatia vertical da Vidomo: um prédio 3D no celular cujas unidades mudam de cor em tempo
real quando o status muda no banco. Contexto, regras e marca em [CLAUDE.md](CLAUDE.md).

```
apps/web          Next.js 16 (App Router): /e/[slug] (público, ?u=802 / ?andar=8), /login, /painel/dev-status
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

| Organização         | E-mail                | Senha            | Papel              |
| ------------------- | --------------------- | ---------------- | ------------------ |
| Construtora Exemplo | `admin@exemplo.test`  | `vidomo-dev-123` | admin              |
| Construtora Exemplo | `vendas@exemplo.test` | `vidomo-dev-123` | vendedor (`sales`) |
| Construtora Teste   | `admin@teste.test`    | `vidomo-dev-123` | admin              |

Chave de ingestão de leads só do ambiente local (`LEADS_INGEST_KEY`):
`vidomo-dev-ingest-key-somente-local-0001` (o banco guarda só o hash).

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
- **Torre × entorno (camada de detalhes):** no modo andar, o que é da torre é recortado na
  altura do andar e o entorno (terreno, rua, portaria, árvores, áreas comuns) fica sempre
  inteiro. A separação é pela projeção no chão: o que cai dentro da pegada de `TOWER__` e
  das lajes `FLOOR__`, com 2 m de margem, é torre; o resto é entorno.
  `pnpm model:validate scripts/out/residencial-vista-detalhes.glb --layer detail` lista as
  duas listas ("Torre (recortada por andar)" e "Entorno (sempre visível)"); confira ali se
  algo caiu do lado errado. TODO: convenção explícita `SITE__` no Blender.
- **Plantas:** imagens no bucket público `plans`, caminho em `unit_types.plan_image_path`
  (lido sempre por `getAssetUrl(path, 'plans')`). Sem imagem, a ficha mostra "Planta
  disponível em breve".

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
pnpm test:unit  # sem banco: viewer, scripts, web, Edge Functions
pnpm test:db    # isolamento multiempresa, acesso anônimo, preço por price_display, histórico e Realtime
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

**Troca de andar:** a página marca `vidomo:view-settled` quando a câmera termina uma
transição (troca de andar ou volta ao prédio). O tempo vai do clique no seletor até essa
marca: 500 ms de animação (easeInOutCubic) mais um quadro; com "reduzir movimento" no
sistema, a troca é imediata.

**Resultados (build de produção local, tela 360×800 @2x, mediana de 3, novembro de 2026):**

| Medida                                  | 4G rápido   | 4G rápido + CPU 4× | Meta            |
| --------------------------------------- | ----------- | ------------------ | --------------- |
| Prédio interativo                       | 1,53 s      | 1,92 s             | ≤ 1,69 s (base) |
| Detalhes na tela                        | 1,98 s      | 2,51 s             | —               |
| Troca de andar (clique → câmera parada) | 0,51–0,54 s | 0,54–0,59 s        | —               |
| fps girando o prédio (GPU do PC)        | 60          | 60                 | ≥ 30            |

JS gzip: página 143 KB, viewer/three.js 274 KB, supabase-js 67 KB (sob demanda). GLB leve
19 KB, detalhes 157 KB. Meta do Bloco 1: até 1,69 s; a demo publicada antes dele media
1,54 s e o build local 1,52 s, ou seja, modos, filtros e ficha quase não mudaram o tempo até
interativo.
Draw calls: prédio 140, 8º andar 94, 1º andar 59. No celular de referência, modo andar:
60 fps de média, 54 de mínimo.

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
| Demo pública        | https://www.vidomo.com.br/e/residencial-vista (a raiz `/` redireciona)  |
| Painel              | https://www.vidomo.com.br/painel/leads (e `/painel/config`, admin)      |
| Painel de status    | https://www.vidomo.com.br/painel/dev-status                             |
| Domínio Vercel      | https://vidomo.vercel.app (mesmo deploy; `vidomo.com.br` → `www`)       |
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

### Leads e notificações

Na ordem, depois do `db push` (migrations até `20261115000400`) e do `demo-seed.sql`:

1. **Chave de ingestão** (o formulário de interesse grava leads pelo servidor do Next). Gere
   no terminal, grave só o hash no banco e leve a chave para a Vercel como
   `LEADS_INGEST_KEY` (ela não fica em arquivo):

   ```bash
   KEY=$(node -e "console.log('vidomo_ing_' + require('crypto').randomBytes(32).toString('hex'))")
   HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$KEY")
   pnpm exec supabase db query --remote "insert into private.ingest_keys (key_hash, label) values ('$HASH', 'vercel produção');"
   echo "$KEY"   # copie para a Vercel e feche o terminal
   ```

   Para trocar: grave a nova, atualize a Vercel e depois
   `update private.ingest_keys set revoked_at = now() where label = '<antiga>';`.

2. **Fila → função**: o banco chama a Edge Function pela URL do projeto; os links dos
   e-mails e do webhook usam `site_url` (padrão `https://www.vidomo.com.br`):

   ```bash
   pnpm exec supabase db query --remote "update private.notification_runtime set function_url = 'https://msqdndtgpjoiipxwkwno.supabase.co/functions/v1/notifications' where id;"
   ```

3. **Edge Function**: `pnpm exec supabase functions deploy notifications` (o
   `verify_jwt = false` vem do `config.toml`; a função confere a própria chave de
   acionamento, que a migration gera no Vault).
4. **Chave do Resend**, só no remoto e só pelo CLI (nunca em arquivo nem na Vercel):
   `pnpm exec supabase secrets set RESEND_API_KEY=re_…`. Sem ela, os e-mails esperam na
   fila e saem quando a chave existir.
5. **Webhook**: o segredo é por ambiente. No site publicado, gere um segredo novo em
   `/painel/config`, cole no n8n e use "Enviar teste".

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

Leitura anônima pela função pública, anônimo sem acesso às tabelas (inclusive leads, fila
de notificações e configuração), anônimo sem a API de envio, Edge Function publicada e
recusando chamada sem a chave, GLBs públicos, cliente sem publicar no tópico e Broadcast
chegando em até 3 s. O teste de Broadcast troca o status
da unidade 1004 e o restaura (deixa 2 linhas no histórico, que é imutável); sem
`SUPABASE_SERVICE_ROLE_KEY` ele é pulado. Os testes que criam e apagam dados ficam só no
local (`pnpm test:db`).

### Deploy na Vercel

- Projeto ligado ao repositório `Gcamara07/vidomo`, **Root Directory `apps/web`**,
  framework Next.js, install/build padrão (pnpm pelo `pnpm-lock.yaml`), com "Include files
  outside the root directory" ligado (precisa do `packages/viewer`).
- Variáveis (Production e Preview): `NEXT_PUBLIC_SUPABASE_URL` e
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (chave **publishable**). Só em Production:
  `LEADS_INGEST_KEY` (sem `NEXT_PUBLIC_`, fica no servidor; sem ela o formulário de
  interesse responde erro e não grava). **A secret do Supabase e a chave do Resend não vão
  para a Vercel.**
- Região das funções: `iad1`, perto do banco em us-east-1 (`apps/web/vercel.json`).
- Deploy: cada push no `main` gera um deploy de produção.
- Supabase → Authentication → URL Configuration: Site URL `https://vidomo.vercel.app` e o
  mesmo domínio nas Redirect URLs. Ajuste pelo painel: `supabase config push` enviaria o
  `config.toml` local inteiro (e religaria o cadastro público).

### Medir a demo publicada

```bash
pnpm measure --network fast4g --runs 9 --url https://www.vidomo.com.br/e/residencial-vista
```

**Bloco 2 (leads), novembro de 2026, 4G rápido, mediana de 9:** prédio interativo em
**1,70 s** no site publicado (variação de 1,50 a 1,97 s entre execuções, por tempo de
resposta e rede reais), detalhes em 2,16 s, 60 fps; com CPU 4× mais lenta, 2,42 s. Bem
dentro da meta do PRD (até 5 s em 4G num aparelho de entrada).

No build local (`next start`, porta 3100) o Bloco 2 mede 1,66 s contra 1,53 s da referência
(`0b948ff`) medida no mesmo momento. A diferença vem do HTTP/1.1 local: a página passou a
ter 15 pedidos antes do three.js (eram 12) e, com no máximo 6 conexões por domínio, o
three.js espera uma ida e volta a mais na fila (~470 ms contra ~300 ms). No site publicado
(HTTP/2, uma conexão) essa fila é de ~6 ms. Com CPU 4× mais lenta os dois builds locais
empatam (2,09 s). JS inicial da página: 146,9 KB gzip (era 143,0 KB). Para comparar com as
medições anteriores, use o build local; o publicado varia demais entre execuções.

## 8. Como funciona (resumo)

- **Banco** (`supabase/migrations`): toda tabela de cliente tem `organization_id` e RLS;
  FKs compostas impedem apontar para outra organização. `anon` não tem acesso direto a
  nenhuma tabela.
- **Status**: `units.status` não tem GRANT de UPDATE; só muda por
  `set_unit_status(p_unit_id, p_new_status, p_reason)`, que valida papel, trava a linha
  (`FOR UPDATE`) e grava `unit_status_history` por trigger (imutável).
- **Leitura pública**: `public_development(slug)` e `public_development_units(slug)` — só
  empreendimento publicado e campos públicos (código, andar, tipo, área, dormitórios,
  suítes, planta, face, frente/fundos, status, preço resolvido).
- **Preço** (`private.public_unit_price`, no banco; o front só formata): `price_display`
  oculto → sem preço ("Consulte condições"); exato → preço da unidade; a partir de → menor
  preço entre as unidades **disponíveis** do mesmo tipo (sem nenhuma disponível, sem preço).
  Vendida nunca mostra preço, em qualquer modo. Depois de cada mudança de status a página
  relê os preços (agrupado em 800 ms), porque o "a partir de" depende das disponíveis.
- **Explorar (página pública)**:
  - Modo prédio e modo andar. No modo andar, a torre é recortada na altura do andar
    (acima some; abaixo vira silhueta clara, sem toque) e o entorno fica inteiro. A câmera
    enquadra o andar em vista oblíqua mantendo o lado de onde se olhava.
  - Seletor de andares com as unidades livres de cada um; filtros por status e
    dormitórios esmaecem (não escondem) quem não atende, com "N de 40" e "Limpar".
  - Ficha completa: planta, área, dormitórios, suítes, face (norte = +Y do Blender;
    finais 1 e 2 norte/frente, 3 e 4 sul/fundos), código, status e preço; "Copiar link"
    (no celular abre o compartilhar do sistema). TODO: seta de norte; "Tenho interesse"
    (Bloco 2).
  - Links: `?u=802` abre o andar com a unidade selecionada; `?andar=8` abre o andar
    (com uma torre só). Inválido cai no prédio e a URL é limpa. A URL acompanha a
    navegação (`replaceState`, sem encher o histórico) e preserva outros parâmetros.
  - O viewer recebe as áreas cobertas pela ficha e pelo seletor (`insets`) e centraliza
    o prédio/andar na área livre, para a ficha não cobrir a unidade selecionada.
- **Realtime**: a página pública assina o Broadcast privado `development:<slug>` (só o
  trigger publica `{object_key, status}`; o anônimo só recebe) e relê tudo ao
  conectar/reconectar, ao voltar do segundo plano e quando a rede volta. O painel usa
  `postgres_changes` em `units`, filtrado pela RLS.
- **Página pública**: o HTML já traz nome, legenda com contagens e um placeholder. O
  chunk do three.js é pré-carregado em paralelo ao JS da página (o `<Viewer>` só monta no
  navegador), o GLB leve também; o de detalhes só depois do prédio interativo. O supabase-js
  (tempo real) é importado sob demanda e conecta depois que o prédio fica interativo (ou em
  6 s); as fontes pré-carregadas são só as da primeira tela.
- **Arquivos 3D e plantas**: sempre via `getAssetUrl()` (buckets públicos `models` e `plans`).

Fora desta fatia (com TODOs no código): reservas com prazo (`reserve_unit`), distribuição
automática de leads, WhatsApp automático para o vendedor, integrações com CRMs específicos
(o webhook cobre via n8n), quiosque, panoramas 360°, admin completo, subdomínios e tema por
organização, regras finas de transição de status (PRD 6.1) e URLs assinadas para modelos de
rascunho.

## 9. Notificações de leads (e-mail e webhook)

Cada lead novo entra numa fila (`notification_deliveries`) na mesma transação do lead:
se o envio falhar, o lead já está gravado. Logo depois do COMMIT, o banco aciona a Edge
Function `notifications` (pg_net, sem esperar resposta: o comprador não espera o envio); a
função envia e devolve o resultado. O pg_cron aciona de novo a cada minuto para os reenvios.

- **Tentativas**: agora, +1 min, +5 min, +30 min e +2 h; depois da 5ª falha a entrega fica
  `failed`. O "Enviar teste" do painel faz uma tentativa só. Cada tentativa (status HTTP,
  erro, duração, sem dado pessoal) fica em `notification_attempts`, legível pelos membros.
  Na falha do webhook, os primeiros 500 caracteres do corpo da resposta também ficam
  gravados (`response_body`, e o último em `notification_deliveries.last_response_body`),
  sem tags HTML e com e-mails e números de 8+ dígitos mascarados. O painel mostra essa
  resposta junto da falha. No Resend, só o nome do erro (a mensagem pode citar endereços).
- **Destino lido na hora do envio**: lista de e-mails atual; webhook na URL ativa atual
  (URL + segredo), assinado com o segredo atual. Webhook desativado ou lista vazia encerram
  a entrega sem novas tentativas.
- **Sem `RESEND_API_KEY`** a função não pega e-mails: eles esperam na fila sem gastar
  tentativas e saem quando a chave for configurada.
- **Segredos**: a chave do Resend só nas variáveis da Edge Function; o segredo do webhook
  no Vault (sai só para a função, pela service_role); a chave que autoriza o banco a acionar
  a função (`X-Vidomo-Dispatch-Key`) é gerada pela migration e também fica no Vault.

### E-mail (Resend)

Remetente `Vidomo <leads@notificacoes.vidomo.com.br>` (domínio verificado no Resend, região
São Paulo), para os e-mails do `/painel/config`, com Reply-To no e-mail do lead quando houver.
Traz unidade, nome, contato (telefone com link para o WhatsApp), mensagem, origem, horário e
o botão "Abrir no painel" (`/painel/leads?lead=<id>`). Cada entrega usa uma chave de
idempotência: um reenvio depois de timeout não duplica o e-mail.

### Webhook

`POST` para a URL do `/painel/config` (https; `http` só para o receptor local), JSON em
UTF-8, sem seguir redirecionamentos, timeout de 10 s. Sucesso é qualquer 2xx.

Cabeçalhos:

| Cabeçalho            | Valor                                                    |
| -------------------- | -------------------------------------------------------- |
| `X-Vidomo-Signature` | `sha256=<HMAC-SHA256 em hex do corpo bruto>`             |
| `X-Vidomo-Delivery`  | id da entrega (o mesmo em todos os reenvios: deduplique) |
| `X-Vidomo-Event`     | `lead.created`, `lead.deleted` ou `test`                 |

`lead.created`:

```json
{
  "event": "lead.created",
  "delivery_id": "6a9a8fae-…",
  "sent_at": "2026-11-15T22:54:21.532Z",
  "organization": { "id": "a0000000-…", "name": "Construtora Exemplo" },
  "development": { "slug": "residencial-vista", "name": "Residencial Vista" },
  "lead": {
    "id": "83745e31-…",
    "name": "Maria Souza",
    "phone": "5516997694880",
    "email": "maria@exemplo.com",
    "message": "Quero visitar no sábado",
    "source": "unit_link",
    "status": "new",
    "created_at": "2026-11-15T22:54:21.486Z",
    "unit": {
      "code": "802",
      "floor": 8,
      "type": "Tipo B",
      "url": "https://www.vidomo.com.br/e/residencial-vista?u=802"
    }
  }
}
```

- `phone`: só dígitos, com DDI (`55…`); `email`, `message` e `unit` podem ser `null`
  (lead manual sem unidade, por exemplo).
- `source`: `portal`, `unit_link`, `stand` ou `manual`. `status`: `new`, `in_progress`,
  `won` ou `lost` (no envio).
- `lead.deleted` (exclusão a pedido do titular, LGPD), só o id:
  `{ "event": "lead.deleted", "delivery_id": "…", "sent_at": "…", "lead": { "id": "…" } }`.
- `test`: o formato do `lead.created`, com `"event": "test"`, a organização real e lead e
  empreendimento fictícios.

**Conferir a assinatura no n8n.** A chave do HMAC é a string completa do segredo, com o
prefixo (`whsec_` + 64 caracteres hex, usada como texto UTF-8; não tire o prefixo nem
decodifique o hex). A mensagem são os bytes exatos do corpo recebido. O cabeçalho é
`X-Vidomo-Signature: sha256=<hex minúsculo>`: compare com `'sha256=' + digest`, não só
com o digest. No nó Webhook, ligue a opção de corpo bruto (Raw Body) e responda pelo nó
"Respond to Webhook". Num nó Code (Run Once for All Items), logo depois do Webhook:

```js
const crypto = require('crypto');
// Segredo do /painel/config: string completa, com whsec_ (de preferência numa credencial).
const secret = 'whsec_…'.trim();
const headers = $input.first().json.headers;
// Bytes exatos recebidos (Raw Body). Não use $json.body nem binary.data.data.
const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
const received = String(headers['x-vidomo-signature'] ?? '').trim();
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const ok =
  received.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
const length = headers['content-length'];
let motivo = null; // diagnóstico sem expor o segredo
if (!ok) {
  if (!received) motivo = 'sem cabeçalho X-Vidomo-Signature';
  else if (!received.startsWith('sha256=')) motivo = 'cabeçalho sem o prefixo sha256=';
  else if (length && raw.length !== Number(length))
    motivo = `corpo bruto com ${raw.length} bytes; o pedido tinha ${length}`;
  else motivo = 'assinatura diferente: confira se o segredo é o atual';
}
return [{ json: { ok, motivo, payload: ok ? JSON.parse(raw.toString('utf8')) : null } }];
```

Depois, um IF em `ok`: verdadeiro → 200 (e o resto do fluxo, deduplicando por
`delivery_id`); falso → 401. Gerar um segredo novo no painel invalida o anterior na hora.

### Local

```bash
pnpm exec supabase functions serve   # Edge Functions (deixe rodando)
```

- O `seed.sql` aponta a fila para a função local (`http://kong:8000/functions/v1/notifications`)
  e os links para `http://localhost:3000`. Num banco já existente, sem reset:
  `update private.notification_runtime set function_url = 'http://kong:8000/functions/v1/notifications', site_url = 'http://localhost:3000';`
- E-mail local: `RESEND_API_KEY=re_…` em `supabase/functions/.env` (fora do git) e reinicie
  o `functions serve` apontando para o arquivo:
  `pnpm exec supabase functions serve --env-file supabase/functions/.env`. Sem a chave, os
  e-mails só esperam na fila (a resposta da função traz `"email":"off"`).
- **Armadilha no Windows:** o Bloco de Notas salva `.env` como `.env.txt` e o Explorer esconde
  a extensão; a função sobe sem a chave e não avisa. Confira com `dir supabase\functions`
  (ou ative "Extensões de nomes de arquivos" no Explorer) e renomeie para `.env`.
- Receptor de teste no lugar do n8n: gere o segredo no `/painel/config`, salve a URL
  `http://host.docker.internal:8787/vidomo` e rode
  `VIDOMO_WEBHOOK_SECRET=whsec_… pnpm webhook:receive` (`--fail 500` para ver os reenvios).
- `pnpm test:db` pausa o envio enquanto roda e restaura a configuração local no fim, mas
  troca o segredo do webhook da org A (o Vault não é legível): depois dos testes o webhook
  fica inativo até você gerar um segredo novo no painel.
