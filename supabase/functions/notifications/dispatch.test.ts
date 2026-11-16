import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  EMAIL_FROM,
  dispatch,
  formatPhone,
  hmacSha256Hex,
  leadEmail,
  redactResponseBody,
  resendRequest,
  responseSnippet,
  sendEmail,
  sendWebhook,
  webhookPayload,
  webhookRequest,
  type FetchFn,
  type Job,
  type Outcome,
} from './dispatch.ts';

const NOW = new Date('2026-11-15T13:05:00.000Z');
const SECRET = 'whsec_' + 'ab'.repeat(32);

const createdJob = (patch: Partial<Job> = {}): Job => ({
  delivery_id: 'd0000000-0000-4000-8000-000000000001',
  channel: 'webhook',
  event: 'lead.created',
  attempt: 1,
  organization: { id: 'a0000000-0000-4000-8000-0000000000a0', name: 'Construtora Exemplo' },
  site_url: 'https://www.vidomo.com.br',
  url: 'https://n8n.exemplo.com/webhook/vidomo',
  secret: SECRET,
  development: { slug: 'residencial-vista', name: 'Residencial Vista' },
  lead: {
    id: 'l0000000-0000-4000-8000-000000000001',
    name: 'Maria <Souza>',
    phone: '5516997694880',
    email: 'maria@exemplo.com',
    message: 'Quero visitar\nno sábado',
    source: 'unit_link',
    status: 'new',
    created_at: '2026-11-15T13:00:00.123456+00:00',
    unit: { code: '802', floor: 8, type: 'Tipo B' },
  },
  ...patch,
});

const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('payload do webhook', () => {
  it('lead.created no formato documentado, com as chaves nessa ordem', () => {
    const payload = webhookPayload(createdJob(), NOW);
    expect(payload).toEqual({
      event: 'lead.created',
      delivery_id: 'd0000000-0000-4000-8000-000000000001',
      sent_at: '2026-11-15T13:05:00.000Z',
      organization: { id: 'a0000000-0000-4000-8000-0000000000a0', name: 'Construtora Exemplo' },
      development: { slug: 'residencial-vista', name: 'Residencial Vista' },
      lead: {
        id: 'l0000000-0000-4000-8000-000000000001',
        name: 'Maria <Souza>',
        phone: '5516997694880',
        email: 'maria@exemplo.com',
        message: 'Quero visitar\nno sábado',
        source: 'unit_link',
        status: 'new',
        created_at: '2026-11-15T13:00:00.123Z',
        unit: {
          code: '802',
          floor: 8,
          type: 'Tipo B',
          url: 'https://www.vidomo.com.br/e/residencial-vista?u=802',
        },
      },
    });
    expect(Object.keys(payload)).toEqual([
      'event',
      'delivery_id',
      'sent_at',
      'organization',
      'development',
      'lead',
    ]);
    expect(Object.keys(payload.lead as object)).toEqual([
      'id',
      'name',
      'phone',
      'email',
      'message',
      'source',
      'status',
      'created_at',
      'unit',
    ]);
  });

  it('lead sem unidade: unit null', () => {
    const job = createdJob();
    (job.lead as { unit: unknown }).unit = null;
    expect((webhookPayload(job, NOW).lead as { unit: unknown }).unit).toBeNull();
  });

  it('lead.deleted leva só o id', () => {
    const payload = webhookPayload(
      createdJob({ event: 'lead.deleted', lead: { id: 'l1' }, development: undefined }),
      NOW,
    );
    expect(payload).toEqual({
      event: 'lead.deleted',
      delivery_id: 'd0000000-0000-4000-8000-000000000001',
      sent_at: '2026-11-15T13:05:00.000Z',
      lead: { id: 'l1' },
    });
  });

  it('test: formato do lead.created, organização real e dados fictícios', () => {
    const payload = webhookPayload(
      createdJob({ event: 'test', lead: undefined, development: undefined }),
      NOW,
    );
    expect(Object.keys(payload)).toEqual(Object.keys(webhookPayload(createdJob(), NOW)));
    expect(payload.event).toBe('test');
    expect(payload.organization).toEqual({
      id: 'a0000000-0000-4000-8000-0000000000a0',
      name: 'Construtora Exemplo',
    });
    expect(payload.lead).toMatchObject({
      name: 'Lead de teste',
      unit: { url: 'https://www.vidomo.com.br/e/empreendimento-teste?u=101' },
    });
  });
});

describe('assinatura', () => {
  it('HMAC-SHA256 em hex do corpo bruto, igual ao do Node (como o n8n confere)', async () => {
    const body = '{"event":"test","ção":1}';
    expect(await hmacSha256Hex(SECRET, body)).toBe(
      createHmac('sha256', SECRET).update(body, 'utf8').digest('hex'),
    );
  });

  it('cabeçalhos X-Vidomo-*, assinatura do corpo exato enviado', async () => {
    const req = await webhookRequest(createdJob(), NOW);
    expect(req.headers['x-vidomo-delivery']).toBe('d0000000-0000-4000-8000-000000000001');
    expect(req.headers['x-vidomo-event']).toBe('lead.created');
    expect(req.headers['x-vidomo-signature']).toBe(
      `sha256=${createHmac('sha256', SECRET).update(req.body).digest('hex')}`,
    );
    expect(JSON.parse(req.body)).toEqual(webhookPayload(createdJob(), NOW));
  });
});

describe('envio do webhook', () => {
  it('2xx entrega; status e duração registrados', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => response(200));
    const out = await sendWebhook(createdJob(), fetchFn, NOW);
    expect(out).toMatchObject({ ok: true, statusCode: 200, error: null });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://n8n.exemplo.com/webhook/vidomo');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
  });

  it.each([
    [401, 'HTTP 401'],
    [500, 'HTTP 500'],
    [302, 'HTTP 302: redirecionamento não é seguido'],
  ])('HTTP %i é falha: %s', async (status, error) => {
    const out = await sendWebhook(createdJob(), async () => response(status), NOW);
    expect(out).toMatchObject({ ok: false, statusCode: status, error });
  });

  it('falha guarda o começo do corpo da resposta (o motivo dado pelo n8n)', async () => {
    const n8n = { code: 0, message: 'There was a problem executing the workflow' };
    const out = await sendWebhook(createdJob(), async () => response(500, n8n), NOW);
    expect(out).toMatchObject({
      ok: false,
      statusCode: 500,
      error: 'HTTP 500',
      responseBody: JSON.stringify(n8n),
    });
    const ok = await sendWebhook(createdJob(), async () => response(200, { echo: 1 }), NOW);
    expect(ok.responseBody ?? null).toBeNull();
  });

  it('timeout e erro de rede viram falha sem detalhes do destino', async () => {
    const timeout = await sendWebhook(
      createdJob(),
      async () => {
        throw new DOMException('signal timed out', 'TimeoutError');
      },
      NOW,
    );
    expect(timeout).toMatchObject({
      ok: false,
      statusCode: null,
      error: 'timeout: sem resposta em 10 s',
    });
    const network = await sendWebhook(
      createdJob(),
      async () => {
        throw new TypeError('getaddrinfo ENOTFOUND n8n.exemplo.com');
      },
      NOW,
    );
    expect(network.error).toBe('rede: TypeError');
  });
});

describe('corpo da resposta', () => {
  it('mascara e-mails e números longos; mantém UUIDs, datas e números curtos', () => {
    expect(
      redactResponseBody(
        'lead maria.souza@exemplo.com.br tel +55 (16) 99769-4880 / 5516997694880 ' +
          'id 00000000-0000-4000-8000-000000000000 em 2026-11-16T01:09:24.263Z, erro 500, nó 12',
      ),
    ).toBe(
      'lead [e-mail] tel [número] / [número] ' +
        'id 00000000-0000-4000-8000-000000000000 em 2026-11-16T01:09:24.263Z, erro 500, nó 12',
    );
  });

  it('até 500 caracteres, sem tags HTML nem quebras de linha', async () => {
    const html = new Response(
      '<html><head><style>p{}</style></head><body>\n<h1>502 Bad Gateway</h1>\n<p>cloudflare</p></body></html>',
      { status: 502, headers: { 'content-type': 'text/html' } },
    );
    expect(await responseSnippet(html)).toBe('502 Bad Gateway cloudflare');
    expect(await responseSnippet(new Response('a'.repeat(5000)))).toHaveLength(500);
    expect(await responseSnippet(new Response(''))).toBeNull();
    expect(await responseSnippet(new Response(null, { status: 500 }))).toBeNull();
  });
});

describe('e-mail', () => {
  const job = createdJob({
    channel: 'email',
    to: ['comercial@exemplo.com', 'gerente@exemplo.com'],
  });

  it('assunto, campos, link do painel e HTML escapado', () => {
    const email = leadEmail(job);
    expect(email.subject).toBe('Novo lead: 802 · Residencial Vista');
    expect(email.replyTo).toBe('maria@exemplo.com');
    expect(email.text).toContain('Unidade: 802 · 8º andar · Tipo B');
    expect(email.text).toContain('Telefone: (16) 99769-4880');
    expect(email.text).toContain('Origem: Link da unidade');
    expect(email.text).toContain('Recebido em: 15/11/2026, 10:00');
    expect(email.text).toContain(
      'Abrir no painel: https://www.vidomo.com.br/painel/leads?lead=l0000000-0000-4000-8000-000000000001',
    );
    expect(email.html).toContain('Maria &lt;Souza&gt;');
    expect(email.html).not.toContain('<Souza>');
    expect(email.html).toContain('Quero visitar<br>no sábado');
    expect(email.html).toContain('href="https://wa.me/5516997694880"');
  });

  it('sem unidade e sem e-mail do lead: sem Reply-To', () => {
    const lead = { ...(job.lead as object), unit: null, email: null } as Job['lead'];
    const email = leadEmail({ ...job, lead });
    expect(email.subject).toBe('Novo lead: Residencial Vista');
    expect(email.replyTo).toBeNull();
    expect(JSON.parse(resendRequest({ ...job, lead }, 're_x').body)).not.toHaveProperty('reply_to');
  });

  it('pedido ao Resend: remetente, destinatários, Reply-To e chave de idempotência', () => {
    const req = resendRequest(job, 're_123');
    expect(req.url).toBe('https://api.resend.com/emails');
    expect(req.headers.authorization).toBe('Bearer re_123');
    expect(req.headers['idempotency-key']).toBe(
      'vidomo-delivery-d0000000-0000-4000-8000-000000000001',
    );
    expect(JSON.parse(req.body)).toMatchObject({
      from: EMAIL_FROM,
      to: ['comercial@exemplo.com', 'gerente@exemplo.com'],
      reply_to: 'maria@exemplo.com',
      subject: 'Novo lead: 802 · Residencial Vista',
    });
  });

  it('erro do Resend grava só o nome do erro (sem endereços)', async () => {
    const out = await sendEmail(job, 're_x', async () =>
      response(422, { name: 'validation_error', message: 'Invalid `to` field: maria@exemplo' }),
    );
    expect(out).toMatchObject({
      ok: false,
      statusCode: 422,
      error: 'Resend HTTP 422: validation_error',
      responseBody: null,
    });
  });

  it('formata telefone fixo e celular', () => {
    expect(formatPhone('551633334444')).toBe('(16) 3333-4444');
    expect(formatPhone(null)).toBe('');
  });
});

describe('dispatch', () => {
  function fakeStore(batches: Job[][]) {
    const completed: [string, Outcome][] = [];
    const claims: string[][] = [];
    return {
      completed,
      claims,
      claim: async (channels: string[]) => {
        claims.push(channels);
        return batches.shift() ?? [];
      },
      complete: async (job: Job, o: Outcome) => {
        completed.push([job.delivery_id, o]);
      },
    };
  }

  it('sem RESEND_API_KEY só pega webhooks (e-mails esperam na fila)', async () => {
    const store = fakeStore([]);
    await dispatch({ store, fetch: async () => response(200), resendApiKey: null });
    expect(store.claims[0]).toEqual(['webhook']);
  });

  it('envia o lote, devolve cada resultado e para quando a fila esvazia', async () => {
    const email = createdJob({ delivery_id: 'e1', channel: 'email', to: ['c@exemplo.com'] });
    const hook = createdJob({ delivery_id: 'w1' });
    const broken = createdJob({ delivery_id: 'w2', secret: undefined });
    const store = fakeStore([[email, hook, broken]]);
    const fetchFn = vi.fn<FetchFn>(async (url) =>
      url.startsWith('https://api.resend.com') ? response(200, { id: 'x' }) : response(500),
    );
    const result = await dispatch({
      store,
      fetch: fetchFn,
      resendApiKey: 're_x',
      batchSize: 10,
    });
    expect(store.claims).toEqual([['email', 'webhook']]);
    expect(result).toEqual({ delivered: 1, failed: 2 });
    expect(Object.fromEntries(store.completed.map(([id, o]) => [id, o.error]))).toEqual({
      e1: null,
      w1: 'HTTP 500',
      w2: 'montagem: webhook sem URL ou segredo',
    });
  });

  it('lote cheio: pede outro', async () => {
    const store = fakeStore([
      [createdJob({ delivery_id: 'a' })],
      [createdJob({ delivery_id: 'b' })],
    ]);
    await dispatch({ store, fetch: async () => response(204), resendApiKey: null, batchSize: 1 });
    expect(store.completed.map(([id]) => id)).toEqual(['a', 'b']);
    expect(store.claims).toHaveLength(3);
  });
});
