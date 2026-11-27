# Vidomo

Fatia vertical da Vidomo: um prédio 3D no celular cujas unidades mudam de cor em tempo
real quando o status muda no banco. Contexto, regras e marca em [CLAUDE.md](CLAUDE.md).

```
apps/web          Next.js 16 (App Router): /e/[slug] (público, ?u= / ?andar= / ?bloco=), /login, /painel/dev-status
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
pnpm model:compress modelos/residencial-vista-leve-v2.glb    # Meshopt → scripts/out/
pnpm model:compress modelos/residencial-vista-detalhes-v2.glb
pnpm model:upload    # camada leve → developments.model_path
pnpm model:upload scripts/out/residencial-vista-detalhes-v2.glb --layer detail
# Interiores (maquetes) por tipo de planta → unit_types.interior_model_path / _detail_
pnpm model:compress modelos/interior-tipo-a-simples.glb   # idem tipo-a, tipo-b-simples, tipo-b
pnpm model:upload scripts/out/interior-tipo-a-simples.glb --layer interior --type "Tipo A"
pnpm model:upload scripts/out/interior-tipo-a.glb --layer interior-detail --type "Tipo A"
pnpm model:upload scripts/out/interior-tipo-b-simples.glb --layer interior --type "Tipo B"
pnpm model:upload scripts/out/interior-tipo-b.glb --layer interior-detail --type "Tipo B"
```

`pnpm model:validate` (camada leve) lista, por unidade com interior, o tipo e o encaixe
(ex.: `espelho Y + 0°`), e avisa unidade em que o interior não cabe na caixa (5 cm) ou cujo
encaixe é ambíguo. Unidade de referência fora do GLB é erro.

Crie `apps/web/.env.local` a partir do [.env.example](.env.example) com os valores de
`pnpm exec supabase status` (URL da API e chave anon). A service_role não vai para o app.

```bash
pnpm dev             # http://localhost:3000/e/residencial-vista
```

`pnpm db:reset` apaga os objetos do Storage: depois de um reset, rode os
`pnpm model:upload` de novo (prédio e interiores). O Studio fica em http://127.0.0.1:54323.

O reset também volta a configuração de notificações (`/painel/config`) para a do seed:
e-mails fictícios e nenhum webhook. Para manter o seu e-mail de teste, ponha um `update` de
`organization_settings` num arquivo em `supabase/seeds/local/` (ignorada pelo git; roda
depois do `seed.sql`).

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

**Fachada com status nas janelas (opcional).** Na camada leve, cada unidade pode ter um
objeto `VIDRO__<object_key>` (ex.: `VIDRO__TA__F06__U601`) com todos os vidros dela, e as
paredes externas ficam num `VIS__FACHADA` (com os vãos). Com `VIDRO__`, o viewer pinta o
status no vidro (mesmas cores e hachuras; esmaecida em Areia; selecionada em Latão com
contorno Nanquim em volta da unidade) e a caixa `UNIT__` fica invisível, só como alvo do
toque. No modo andar, a caixa colorida volta no andar ativo; com maquete, fachada e vidros
do andar são cortados rente à laje. Unidade sem `VIDRO__` continua como caixa colorida. O
`model:validate` avisa unidade sem `VIDRO__` e `VIDRO__` sem unidade. Na camada de
detalhes, materiais opacos sem textura (caixilhos, móveis das varandas) são desenhados num
lote só, com a cor gravada nos vértices.

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

### Empreendimento com vários blocos

Um condomínio de vários blocos (ou torres) usa a mesma convenção de nomes; o que muda é só
o dado. Nenhum código depende do empreendimento: 1 torre é o caso mais simples.

**No Blender (modelo leve):**

- Um código por bloco, só letras maiúsculas e números, usado em todos os objetos dele:
  `TOWER__B09`, lajes `FLOOR__B09__F01` … `FLOOR__B09__F04`, unidades
  `UNIT__B09__F02__U201`. `F01` é o primeiro andar com laje (o térreo, se houver unidades
  nele); o número do andar vem do nome, não da posição.
- O código da unidade (`U201`) pode se repetir entre blocos; dentro do bloco, não.
- `TOWER__<bloco>` pode ser o núcleo (circulação) ou a casca do bloco; a laje `FLOOR__`
  deve cobrir as unidades do andar. O enquadramento do bloco, a forma dele em planta e a
  cota de cada andar saem daí.
- **Norte em +Y** no Blender (−Z no glTF). A face de cada unidade (norte, sul, leste, oeste)
  é calculada pela direção do centro do bloco ao centro da unidade.
- **Blocos colados (pares do mesmo prédio):** não há convenção de nome. Dois blocos são
  colados quando as lajes deles se tocam em planta (folga de 0,5 m); no modo andar, os
  dois são recortados juntos e o resto do condomínio vira silhueta. Modele os pares com as
  lajes encostadas. O validador lista os pares que encontrou.
- **Camada de detalhes:** pode juntar o mesmo elemento de todos os blocos numa malha só
  (ex.: `VIS__ESQUADRIAS`); o viewer divide por bloco ao carregar. Terreno, pisos e áreas
  comuns ficam como entorno.

**Banco:** `towers.name` ("Bloco 09"), `towers.short_name` ("09": rótulo no 3D, seletor e
`?bloco=09`), `towers.sort_order` (ordem no seletor), `floors.label` ("Térreo") e
`developments.viewer_cameras` (`{"default": {"position": […], "target": […]}}`, a vista
inicial do condomínio; sem ela o viewer enquadra sozinho).

**Seed a partir do GLB** (blocos, andares, unidades e face pelos nomes e posições; nome,
tipos de planta, preços e câmera num JSON — formato em `scripts/lib/model-seed.ts`):

```bash
pnpm model:compress modelos/<leve>.glb
pnpm model:seed modelos/<leve>.glb --config supabase/seeds/local/<slug>.json --out supabase/seeds/local/<slug>.sql
pnpm db:reset          # carrega seed.sql e depois supabase/seeds/local/*.sql
pnpm model:validate scripts/out/<leve>.glb --slug <slug>   # diferenças por bloco e pares
pnpm model:upload scripts/out/<leve>.glb --slug <slug>
```

`supabase/seeds/local/` é ignorada pelo git (seeds só deste computador, como o teste de
vários blocos com imagens de terceiros, que nunca vai para o remoto nem para a Vercel). Sem
a pasta, o `db reset` só avisa "no files matched pattern" e segue.

### Interiores (maquetes e "Ver apartamento")

Cada tipo de planta pode ter um interior em maquete: no modo andar, as unidades do andar
ativo trocam a caixa colorida por ele; na ficha, "Ver apartamento" abre a versão detalhada,
girando, com as etiquetas dos cômodos. Tipo sem interior continua como antes.

**Como modelar (Blender)**

- Modele sobre uma **unidade de referência** do prédio (ex.: a `U201` para o Tipo A), nas
  coordenadas do próprio prédio: Z para cima, norte em +Y. `z = 0` é o piso acabado (topo da
  laje `FLOOR__`). Não precisa modelar as outras unidades do tipo: o viewer encaixa sozinho.
- Paredes **cortadas a 1,4 m**, com o topo (corte) em Nanquim. A varanda entra no interior
  (com guarda-corpo igual ao do prédio).
- Um objeto por material: `VIS__INT<tipo>_<MATERIAL>` (ex.: `VIS__INTA_PAREDE`,
  `VIS__INTA_CORTE`, `VIS__INTA_MADEIRA`). Papéis:
  - `…_PISO`, `…_MADEIRA_PISO`, `…_MOLHADO`: pisos, tingidos pelo status no modo andar (com
    hachura em reservado e em negociação). O `…_PISO` (base) é obrigatório.
  - `…_VIDRO`: vidro semitransparente. O resto (inclusive `…_VARANDA`): cor do material.
  - Pisos em alturas diferentes (sem faces coincidentes): base de 0,002 a 0,010; madeira e
    molhado a partir de 0,010; varanda abaixo de 0.
- Duas versões por tipo: **simples** (modo andar; até ~7 mil triângulos, ~100 KB
  comprimido) e **detalhada** ("Ver apartamento"; cantos arredondados, ~35–40 mil
  triângulos, ~500 KB comprimido). Exporte as duas em GLB e comprima com `pnpm model:compress`.

**Encaixe nas outras unidades.** Sai da geometria, sem posição no código: a caixa
`UNIT__` de cada unidade é comparada com a da unidade de referência. Os lados da caixa
encostados na borda da laje são externos (fachada, oitão); entre as 8 transformações
(rotação de 0°, 90°, 180° ou 270°, com ou sem espelho), vale a que leva os lados externos da
referência aos da unidade e cujas medidas batem (5 cm). Assim as unidades 3 e 4 do Vista,
espelhadas, e blocos virados para lados diferentes encaixam sozinhos. Empate (ex.: unidade
de meio de fileira, só com a fachada externa): sem espelho e menor rotação, e o validador
avisa "ambígua". TODO: forçar a orientação por uma propriedade na caixa `UNIT__` no Blender
(custom property exportada como extras do glTF).

**Cadastro.** Em `unit_types`: `interior_model_path` (simples), `interior_detail_model_path`
(detalhado) e `interior_reference_unit` (object_key da unidade de referência). Os cômodos
ficam em `unit_type_rooms` (nome, área em m², posição da etiqueta x/y nas coordenadas do
Blender e ordem). Exemplo (o seed do Vista faz isso para os tipos A e B):

```sql
update public.unit_types
   set interior_model_path = 'residencial-vista/interior-tipo-a-simples.glb',
       interior_detail_model_path = 'residencial-vista/interior-tipo-a.glb',
       interior_reference_unit = 'TA__F02__U201'
 where id = '<tipo>';

insert into public.unit_type_rooms
  (organization_id, unit_type_id, name, area_m2, label_x, label_y, sort_order)
values ('<org>', '<tipo>', 'Estar · jantar', 20.9, -3.3, 5.0, 1);
```

Depois: `pnpm model:upload … --layer interior|interior-detail --type "Tipo A"` (comandos na
seção 2) e `pnpm model:validate` (camada leve), que lista o encaixe de cada unidade. A área
privativa mostrada continua a do tipo (`unit_types.area_m2`).

**Na página pública.** Interior sob demanda: os GLBs simples só baixam ao entrar num andar
(um por tipo, reaproveitado entre andares); o detalhado baixa em segundo plano quando a
ficha de uma unidade com interior abre (nunca com economia de dados nem em 2g) e no toque em
"Ver apartamento". `?u=802&ver=1` abre direto no apartamento; o "Copiar link" da ficha
continua `?u=802`.

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
sem recarregar o modelo. `?model=<url>` carrega outro GLB. `?demo=blocos` usa o teste de
vários blocos (GLBs comprimidos em `scripts/out/`, fora do git); `?tower=B09` e
`?floor=B09__F02` abrem direto no bloco ou no andar.

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

**Troca de andar e de bloco:** a página marca `vidomo:view-settled` quando a câmera termina
uma transição. O `pnpm measure` toca no seletor depois do fps e mede do toque até essa
marca (500 ms de animação, easeInOutCubic, mais o quadro): andar → andar sempre; com vários
blocos, também vista geral → bloco e bloco → andar. Com "reduzir movimento" no sistema, a
troca é imediata.

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

**Bloco M (vários blocos), 22/11/2026, 4G rápido, build de produção local, mediana de 5:**

| Medida                  | Residencial Vista (antes → depois) | Teste de 20 blocos (local, fora do git) |
| ----------------------- | ---------------------------------- | --------------------------------------- |
| Interativo              | 1,65–1,69 s → 1,68–1,69 s          | 1,84 s (CPU 4×: 2,75 s)                 |
| Detalhes na tela        | —                                  | 2,61 s (CPU 4×: 3,97 s)                 |
| Vista geral → bloco     | —                                  | 0,57 s (CPU 4×: 0,72 s)                 |
| Bloco → andar           | —                                  | 0,55 s (CPU 4×: 0,66 s)                 |
| Andar → andar           | 0,51–0,52 s                        | 0,51 s (CPU 4×: 0,56 s)                 |
| fps girando (GPU do PC) | 60                                 | 60 (CPU 4×: 25–34 na vista geral)       |

O Vista foi medido em A/B alternado contra o build de antes do Bloco M (mesmo banco e mesma
máquina): +0,9% na média. Draw calls (`?debug=1`): vista geral dos 20 blocos 970 (cada
unidade e laje com seu contorno), modo bloco 208, modo andar 65; Vista 140. Com CPU 4×, o
fps da vista geral oscilou com a carga da máquina (25–34); no modo bloco, 40–56.

**Desenho em lotes (Bloco M, etapa 5).** Unidades com a mesma aparência no mesmo bloco viram
uma malha só, com um contorno só; lajes, estrutura e detalhes, por aparência. A seleção
continua por unidade (o triângulo tocado diz a unidade), e a mudança de status refaz só os
lotes envolvidos (21–42 ms até o quadro seguinte, com CPU 4×). A/B alternado contra o build
anterior, mesmo banco e mesma máquina, mediana de 3:

| Medida                               | Antes                     | Depois                    |
| ------------------------------------ | ------------------------- | ------------------------- |
| Draw calls, 20 blocos: vista geral   | 970                       | 196                       |
| Draw calls, 20 blocos: bloco / andar | 208 / 65                  | 36 / 39                   |
| Draw calls, Vista: prédio / 8º andar | 140 / 94                  | 38 / 41                   |
| fps vista geral, 20 blocos, CPU 4×   | 16–17                     | 45–53                     |
| Interativo, 20 blocos (CPU 4×)       | 1,90–1,92 s (3,98–4,08 s) | 1,85 s (3,25–3,54 s)      |
| Interativo, Vista (CPU 4×)           | 1,70–1,72 s (2,86–2,89 s) | 1,72–1,75 s (2,77–2,80 s) |
| fps Vista, CPU 4×                    | 58–59                     | 60                        |

**Bloco 3 (interiores e fachada v2), 23/11/2026, build local, 4G rápido, mediana de 3**
(`pnpm measure --network fast4g --runs 3`; GLBs separados por fase):

| Medição                                       | 4G rápido                | + CPU 4×      | Meta         |
| --------------------------------------------- | ------------------------ | ------------- | ------------ |
| Prédio interativo (antes do bloco: 1,72 s)    | 1,77 s (+3 %)            | 2,18 s        | até +5 %     |
| Detalhes do prédio na tela                    | 2,74 s                   | 3,51 s        | —            |
| Maquetes, 1ª entrada num andar                | 0,50 s                   | 0,89 s        | até 1,5 s    |
| Troca de andar (câmera / maquetes)            | 0,56 / 0,04 s            | 0,73 / 0,21 s | ~0,5 s       |
| "Ver apartamento" aberto (ficha → modelo)     | 0,84 s                   | 1,51 s        | até 2 s      |
| fps: prédio / andar / "Ver apartamento"       | 60 / 60 / 59             | 60 / 60 / 60  | ≥ 30         |
| GLB: leve / detalhes / maquetes / apartamento | 118 / 556 / 209 / 551 KB |               | cena ≤ 10 MB |

O "Ver apartamento" conta com o pré-carregamento do GLB detalhado quando a ficha abre (2,5 s
de leitura antes do toque); sem ele, 1,7 s no 4G rápido. Draw calls (Vista): vista geral
38 → 15, modo andar com maquetes 31.

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

**Sem dados de produção**: só a Construtora Exemplo, o Residencial Vista e o Residencial Jardim
das Águas (segundo demo, 6 blocos: https://www.vidomo.com.br/e/jardim-das-aguas).

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

Quando uma migration muda uma função pública (ex.: `20261122000100` e `20261122000200`, do
Bloco M), aplique no remoto **antes** do deploy do front; se a Edge Function `notifications`
mudou junto, publique-a também (`pnpm exec supabase functions deploy notifications`).

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

**Teste de ponta a ponta no site publicado (16/11/2026):** login no painel; "Enviar teste"
entregue ao n8n Cloud (HTTP 200); um lead real pelo celular, aberto pelo link da unidade
(`unit_link`, unidade 202), chegou ao painel em tempo real, por e-mail (Resend, caixa de
entrada) e à planilha do n8n. As três entregas (teste, e-mail e webhook) saíram na
primeira tentativa, com HTTP 200.

### Modelos 3D

Arquivos novos sobem **antes** do seed que aponta para eles (`--path` envia para o caminho
dado, sem depender do cadastro): o site publicado nunca aponta para um arquivo que ainda não
existe. Bloco 3 (fachada v2 e interiores do Vista):

```bash
pnpm model:upload scripts/out/residencial-vista-leve-v2.glb --path residencial-vista/residencial-vista-leve-v2.glb
pnpm model:upload scripts/out/residencial-vista-detalhes-v2.glb --layer detail --path residencial-vista/residencial-vista-detalhes-v2.glb
pnpm model:upload scripts/out/interior-tipo-a-simples.glb --layer interior --type "Tipo A" --path residencial-vista/interior-tipo-a-simples.glb
pnpm model:upload scripts/out/interior-tipo-a.glb --layer interior-detail --type "Tipo A" --path residencial-vista/interior-tipo-a.glb
pnpm model:upload scripts/out/interior-tipo-b-simples.glb --layer interior --type "Tipo B" --path residencial-vista/interior-tipo-b-simples.glb
pnpm model:upload scripts/out/interior-tipo-b.glb --layer interior-detail --type "Tipo B" --path residencial-vista/interior-tipo-b.glb
pnpm exec supabase db query --remote -f supabase/demo-seed.sql   # passa a apontar para eles
```

**Empreendimento novo** (ex.: Jardim das Águas, 27/11/2026): o `model:upload` lê o cadastro do
remoto, então aqui a ordem é o `demo-seed.sql` primeiro e o upload logo em seguida (a página
nova fica sem 3D só nesse intervalo; os outros empreendimentos não mudam):

```bash
pnpm exec supabase db query --remote -f supabase/demo-seed.sql
pnpm model:upload scripts/out/jardim-das-aguas-leve.glb --slug jardim-das-aguas
pnpm model:upload scripts/out/jardim-das-aguas-detalhes.glb --slug jardim-das-aguas --layer detail
pnpm model:upload scripts/out/jda-interior-tipo-a-simples.glb --slug jardim-das-aguas --layer interior --type "Tipo A"
# … e os outros 7 interiores (--layer interior | interior-detail, --type "Tipo A", "Tipo B",
#   "Tipo A térreo com quintal", "Tipo B térreo com quintal")
```

O seed do Jardim das Águas é gerado: `supabase/seeds/jardim-das-aguas.json` →
`pnpm model:seed modelos/jardim-das-aguas-leve.glb --config supabase/seeds/jardim-das-aguas.json --out supabase/seeds/jardim-das-aguas.sql`;
o mesmo bloco vai copiado no fim do `demo-seed.sql`.

O upload valida o GLB antes de enviar (camada leve: contra as unidades do remoto; interior:
nomes `VIS__INT…` e piso de base).

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

**Bloco M (vários blocos), 22/11/2026, 4G rápido, mediana de 9:** prédio interativo em
**1,58 s** no site publicado (variação de 1,52 a 1,81 s), detalhes em 2,07 s, 60 fps; com CPU
4× mais lenta, 2,04 s. Contra o Bloco 2: 1,70 s, 2,16 s e 2,42 s. Uma rodada de 5 execuções
feita logo depois do deploy deu 1,94 s; minutos depois, voltou à faixa acima. JS inicial da
página: 151,7 KB gzip (era 146,9 KB); viewer/three.js: 288,1 KB. `pnpm test:remote`: 28 de 28.

**Bloco 3 (interiores e fachada v2), 23/11/2026, 4G rápido, mediana de 9:** prédio
interativo em **1,74 s** no site publicado (variação de 1,56 a 1,97 s), detalhes em 2,68 s,
60 fps; com CPU 4× mais lenta, 2,09 s. Contra o Bloco M: 1,58 s, 2,07 s e 2,04 s. A camada
leve passou de 18 KB para 118 KB (fachada com janelas e `VIDRO__`, aceito até +10 % na etapa
1b); no build local, a diferença do bloco inteiro foi de +3 % (1,72 → 1,77 s). Maquetes na
1ª entrada num andar: 0,81 s (CPU 4×: 0,96 s); troca de andar: 0,56 s, maquetes em 0,04 s;
"Ver apartamento" aberto: 0,85 s (CPU 4×: 1,46 s); fps no andar e no apartamento: 60. GLBs:
maquetes 210 KB, apartamento 552 KB. JS inicial da página: 153,3 KB gzip; viewer/three.js:
295,8 KB. `pnpm test:remote`: 30 de 30. **Nova referência do prédio interativo publicado:
1,74 s** (4G rápido, mediana de 9); as próximas medições comparam com ela.

**Residencial Jardim das Águas (segundo demo, 6 blocos), 27/11/2026, 4G rápido, mediana de 9,
site publicado** (`--unit B03-204`):

| Medida                              | Vista (ref. 1,74 s) | Jardim das Águas | Jardim das Águas, CPU 4× |
| ----------------------------------- | ------------------- | ---------------- | ------------------------ |
| Interativo                          | 1,76 s (+1 %)       | 2,30 s           | 2,60 s                   |
| Detalhes na tela                    | 2,75 s              | 4,05 s           | 6,84 s                   |
| Maquetes, 1ª entrada num andar      | 0,74 s              | 0,98 s           | 1,23 s                   |
| Vista geral → bloco / bloco → andar | —                   | 0,53 / 0,54 s    | 0,61 / 0,63 s            |
| Andar → andar (câmera / maquetes)   | 0,56 / 0,04 s       | 0,58 / 0,07 s    | 0,85 / 0,31 s            |
| "Ver apartamento" aberto            | 0,85 s              | 0,94 s           | 3,21 s                   |
| fps (prédio, andar, apartamento)    | 60                  | 60               | 60                       |

GLBs do Jardim das Águas: leve 257 KB, detalhes 1,14 MB, maquetes 265 KB, apartamento 634 KB.
Interativo no Jardim das Águas: de 1,96 a 5,22 s entre execuções (uma execução com FCP de 4 s,
de rede); no build local, 1,92 s. O "Ver apartamento" com CPU 4× disputa o processador com a
camada de detalhes do prédio (1,14 MB, 113 mil triângulos), que ainda está carregando quando a
ficha abre: esperando os detalhes terminarem antes do toque, cai de 3,09 s para 1,68 s no build
local (Vista: 1,45 s). `pnpm test:remote`: 34 de 34 (4 novos do Jardim das Águas).

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
    (com uma torre só). Com vários blocos: `?bloco=09` abre o bloco (aceita `09`, `B09`
    ou `9`), `?bloco=09&andar=2` o andar dele e `?u=B09-201` a unidade (o código leva o
    bloco só quando se repete entre blocos; senão continua `?u=802`). Inválido cai na
    vista geral e a URL é limpa. A URL acompanha a
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
      "tower": { "code": "TA", "name": "Torre A" },
      "floor": 8,
      "floor_label": null,
      "type": "Tipo B",
      "url": "https://www.vidomo.com.br/e/residencial-vista?u=802"
    }
  }
}
```

- `phone`: só dígitos, com DDI (`55…`); `email`, `message` e `unit` podem ser `null`
  (lead manual sem unidade, por exemplo).
- `unit.tower`: o bloco (torre) da unidade, como cadastrado. `unit.floor_label`: rótulo do
  andar (ex.: `"Térreo"`) ou `null`. `unit.url`: com vários blocos, quando o código se
  repete entre eles, o link leva o bloco (`?u=B09-201`).
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
