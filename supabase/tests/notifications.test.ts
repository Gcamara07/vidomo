/**
 * Envio da fila (Bloco 2, Etapa 4): lote para a Edge Function, reenvio com espera crescente,
 * prazo estourado, destino lido na hora do envio, registro das tentativas e acesso.
 *
 * Usa a org B (Construtora Teste) e leads manuais: o segredo do webhook da org A fica
 * intacto para o teste manual com o n8n. O envio está pausado durante os testes
 * (global-setup); aqui o lote é pedido só com os ids criados neste arquivo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const { url, anonKey, serviceKey } = inject('supabase');
const PASSWORD = 'vidomo-dev-123';
const ORG_A = 'a0000000-0000-4000-8000-0000000000a0';
const ORG_B = 'b0000000-0000-4000-8000-0000000000b0';
const HOOK = 'https://hooks.exemplo.test/vidomo';

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (key = anonKey) => createClient(url, key, clientOptions);
const service = newClient(serviceKey);
const anon = newClient();
let adminA: SupabaseClient;
let adminB: SupabaseClient;
let devB: string;
let unit202: string;
let secretB: string;

async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`);
  return client;
}

type Job = Record<string, unknown> & { delivery_id: string; attempt: number };
type Delivery = {
  id: string;
  channel: 'email' | 'webhook';
  event: string;
  status: string;
  attempts: number;
  target: string;
  last_error: string | null;
  last_response_body: string | null;
  last_status_code: number | null;
  next_attempt_at: string;
  delivered_at: string | null;
};

const createdLeads: string[] = [];
const createdDeliveries: string[] = [];
let settingsBefore: Record<string, unknown> | null = null;

async function manualLead(unitId: string | null = unit202): Promise<string> {
  const { data, error } = await adminB.rpc('create_manual_lead', {
    p_development_id: devB,
    p_unit_id: unitId,
    p_name: 'Paula Estande',
    p_phone: '(11) 98888-7777',
    p_email: 'paula@exemplo.test',
    p_message: 'Visitou o estande.',
    p_consent_in_person: true,
  });
  if (error) throw new Error(`create_manual_lead: ${error.message}`);
  const id = (data as { id: string }).id;
  createdLeads.push(id);
  return id;
}

async function deliveriesOf(leadId: string): Promise<Delivery[]> {
  const { data, error } = await service
    .from('notification_deliveries')
    .select('*')
    .eq('lead_id', leadId)
    .order('channel');
  if (error) throw error;
  return data as Delivery[];
}

async function delivery(id: string): Promise<Delivery> {
  const { data, error } = await service
    .from('notification_deliveries')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Delivery;
}

async function claim(ids: string[], channels = ['email', 'webhook']): Promise<Job[]> {
  const { data, error } = await service.rpc('claim_notification_deliveries', {
    p_channels: channels,
    p_limit: 10,
    p_delivery_ids: ids,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return data as Job[];
}

async function complete(
  job: Job,
  ok: boolean,
  statusCode: number | null,
  error: string | null,
  responseBody?: string,
) {
  const res = await service.rpc('complete_notification_delivery', {
    p_delivery_id: job.delivery_id,
    p_attempt: job.attempt,
    p_ok: ok,
    p_status_code: statusCode,
    p_error: error,
    p_duration_ms: 42,
    ...(responseBody !== undefined ? { p_response_body: responseBody } : {}),
  });
  if (res.error) throw new Error(`complete: ${res.error.message}`);
  return res.data as string;
}

/** Faz a próxima tentativa vencer agora (simula o tempo passando). */
async function makeDue(id: string) {
  const r = await service
    .from('notification_deliveries')
    .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', id);
  if (r.error) throw r.error;
}

async function attemptsOf(id: string) {
  const { data, error } = await service
    .from('notification_attempts')
    .select('attempt, ok, status_code, error, duration_ms')
    .eq('delivery_id', id)
    .order('attempt');
  if (error) throw error;
  return data;
}

const minutesUntil = (iso: string) => (new Date(iso).getTime() - Date.now()) / 60_000;

async function setWebhookB(active: boolean) {
  const r = await service
    .from('organization_settings')
    .update({ webhook_url: active ? HOOK : null, webhook_secret_set_at: null })
    .eq('organization_id', ORG_B);
  if (r.error) throw r.error;
  if (active) {
    const s = await adminB.rpc('rotate_webhook_secret', { p_organization_id: ORG_B });
    if (s.error) throw s.error;
    secretB = s.data as string;
  }
}

beforeAll(async () => {
  [adminA, adminB] = await Promise.all([signIn('admin@exemplo.test'), signIn('admin@teste.test')]);
  const { data: dev } = await service
    .from('developments')
    .select('id')
    .eq('slug', 'residencial-teste')
    .single();
  devB = dev!.id;
  const { data: u } = await service
    .from('units')
    .select('id')
    .eq('development_id', devB)
    .eq('code', '202')
    .single();
  unit202 = u!.id;

  const { data: s } = await service
    .from('organization_settings')
    .select('notification_emails, webhook_url, webhook_secret_set_at')
    .eq('organization_id', ORG_B)
    .single();
  settingsBefore = s;
  const r = await service
    .from('organization_settings')
    .update({ notification_emails: ['comercial@teste.test', 'gerente@teste.test'] })
    .eq('organization_id', ORG_B);
  if (r.error) throw r.error;
  await setWebhookB(true);
});

afterAll(async () => {
  if (createdLeads.length) {
    const del = await service.from('leads').delete().in('id', createdLeads);
    if (del.error) throw del.error;
  }
  if (createdDeliveries.length) {
    const del = await service.from('notification_deliveries').delete().in('id', createdDeliveries);
    if (del.error) throw del.error;
  }
  const restore = await service
    .from('organization_settings')
    .update({
      notification_emails: (settingsBefore?.notification_emails as string[]) ?? [
        'comercial@teste.test',
      ],
      webhook_url: null,
      webhook_secret_set_at: null,
    })
    .eq('organization_id', ORG_B);
  if (restore.error) throw restore.error;
  await Promise.all([adminA, adminB].map((c) => c.auth.signOut()));
});

describe('lote para a Edge Function', () => {
  it('entrega os dados do lead, o destino atual e o segredo; marca como enviando', async () => {
    const leadId = await manualLead();
    const [email, hook] = await deliveriesOf(leadId);
    expect([email!.channel, hook!.channel]).toEqual(['email', 'webhook']);

    const jobs = await claim([email!.id, hook!.id]);
    expect(jobs).toHaveLength(2);
    const byChannel = Object.fromEntries(jobs.map((j) => [j.channel as string, j]));

    const common = {
      event: 'lead.created',
      attempt: 1,
      organization: { id: ORG_B, name: 'Construtora Teste' },
      site_url: expect.stringMatching(/^https?:\/\//),
      development: { slug: 'residencial-teste', name: 'Residencial Teste' },
      lead: {
        id: leadId,
        name: 'Paula Estande',
        phone: '5511988887777',
        email: 'paula@exemplo.test',
        message: 'Visitou o estande.',
        source: 'manual',
        status: 'new',
        created_at: expect.any(String),
        unit: {
          code: '202',
          link_code: '202',
          tower: { code: 'TB', name: 'Torre B' },
          floor: 2,
          floor_label: null,
          type: 'Tipo B',
        },
      },
    };
    expect(byChannel.email).toEqual({
      ...common,
      delivery_id: email!.id,
      channel: 'email',
      to: ['comercial@teste.test', 'gerente@teste.test'],
    });
    expect(byChannel.webhook).toEqual({
      ...common,
      delivery_id: hook!.id,
      channel: 'webhook',
      url: HOOK,
      secret: secretB,
    });

    const after = await deliveriesOf(leadId);
    expect(after.map((d) => [d.status, d.attempts])).toEqual([
      ['sending', 1],
      ['sending', 1],
    ]);
    // Já pegas: um segundo lote não as devolve.
    expect(await claim([email!.id, hook!.id])).toEqual([]);
  });

  it('só os canais pedidos (sem chave do Resend, e-mails esperam sem gastar tentativa)', async () => {
    const leadId = await manualLead();
    const [email, hook] = await deliveriesOf(leadId);
    const jobs = await claim([email!.id, hook!.id], ['webhook']);
    expect(jobs.map((j) => j.channel)).toEqual(['webhook']);
    expect(await delivery(email!.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('lead sem unidade: unit null', async () => {
    const leadId = await manualLead(null);
    const [, hook] = await deliveriesOf(leadId);
    const [job] = await claim([hook!.id]);
    expect((job!.lead as { unit: unknown }).unit).toBeNull();
  });

  it('pausado, o lote geral vem vazio (os testes rodam com o envio pausado)', async () => {
    const { data, error } = await service.rpc('claim_notification_deliveries', {
      p_channels: ['email', 'webhook'],
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('resultado e reenvio', () => {
  it('sucesso: entregue, com status HTTP e tentativa registrada', async () => {
    const leadId = await manualLead();
    const [email] = await deliveriesOf(leadId);
    const [job] = await claim([email!.id]);
    expect(await complete(job!, true, 200, null)).toBe('delivered');
    expect(await delivery(email!.id)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      last_status_code: 200,
      last_error: null,
      delivered_at: expect.any(String),
    });
    expect(await attemptsOf(email!.id)).toEqual([
      { attempt: 1, ok: true, status_code: 200, error: null, duration_ms: 42 },
    ]);
    // Resultado repetido ou atrasado não muda nada.
    expect(await complete(job!, false, 500, 'HTTP 500')).toBe('stale');
    expect(await attemptsOf(email!.id)).toHaveLength(1);
  });

  it('falhas: espera de 1 min, 5 min, 30 min e 2 h; na 5ª, falha final', async () => {
    const leadId = await manualLead();
    const [, hook] = await deliveriesOf(leadId);
    const waits = [1, 5, 30, 120];

    for (let attempt = 1; attempt <= 5; attempt++) {
      await makeDue(hook!.id);
      const [job] = await claim([hook!.id]);
      expect(job!.attempt).toBe(attempt);
      const status = await complete(job!, false, 503, 'HTTP 503');
      const d = await delivery(hook!.id);
      if (attempt < 5) {
        expect(status).toBe('pending');
        expect(minutesUntil(d.next_attempt_at)).toBeGreaterThan(waits[attempt - 1]! - 0.5);
        expect(minutesUntil(d.next_attempt_at)).toBeLessThan(waits[attempt - 1]! + 0.5);
        // Antes da hora, não volta no lote.
        expect(await claim([hook!.id])).toEqual([]);
      } else {
        expect(status).toBe('failed');
        expect(d).toMatchObject({
          status: 'failed',
          attempts: 5,
          last_status_code: 503,
          last_error: 'HTTP 503',
        });
      }
    }
    const log = await attemptsOf(hook!.id);
    expect(log.map((a) => [a.attempt, a.ok, a.status_code])).toEqual([
      [1, false, 503],
      [2, false, 503],
      [3, false, 503],
      [4, false, 503],
      [5, false, 503],
    ]);
    await makeDue(hook!.id);
    expect(await claim([hook!.id])).toEqual([]);
  });

  it('falha guarda o começo da resposta do destino (até 500 caracteres); sucesso limpa', async () => {
    const leadId = await manualLead();
    const [, hook] = await deliveriesOf(leadId);
    const n8n = '{"code":0,"message":"There was a problem executing the workflow"}';

    let [job] = await claim([hook!.id]);
    await complete(job!, false, 500, 'HTTP 500', n8n);
    expect(await delivery(hook!.id)).toMatchObject({
      status: 'pending',
      last_error: 'HTTP 500',
      last_response_body: n8n,
    });

    await makeDue(hook!.id);
    [job] = await claim([hook!.id]);
    await complete(job!, false, 502, 'HTTP 502', 'x'.repeat(800));
    expect((await delivery(hook!.id)).last_response_body).toHaveLength(500);

    await makeDue(hook!.id);
    [job] = await claim([hook!.id]);
    await complete(job!, true, 200, null, 'ok, ignorado no sucesso');
    expect((await delivery(hook!.id)).last_response_body).toBeNull();

    const { data, error } = await service
      .from('notification_attempts')
      .select('attempt, response_body')
      .eq('delivery_id', hook!.id)
      .order('attempt');
    if (error) throw error;
    expect(data.map((a) => [a.attempt, a.response_body?.length ?? null])).toEqual([
      [1, n8n.length],
      [2, 500],
      [3, null],
    ]);
  });

  it('a função caiu no meio (prazo estourado): conta como falha por timeout e volta para a fila', async () => {
    const leadId = await manualLead();
    const [, hook] = await deliveriesOf(leadId);
    await claim([hook!.id]);
    await makeDue(hook!.id); // o prazo de 2 min passou sem resultado
    expect(await claim([hook!.id])).toEqual([]);
    const d = await delivery(hook!.id);
    expect(d).toMatchObject({ status: 'pending', attempts: 1 });
    expect(d.last_error).toMatch(/^timeout/);
    expect(minutesUntil(d.next_attempt_at)).toBeGreaterThan(0.5);
    expect((await attemptsOf(hook!.id))[0]).toMatchObject({ attempt: 1, ok: false });
  });

  it('webhook desativado depois do lead: encerra sem novas tentativas', async () => {
    const leadId = await manualLead();
    const [, hook] = await deliveriesOf(leadId);
    await setWebhookB(false);
    try {
      expect(await claim([hook!.id])).toEqual([]);
      expect(await delivery(hook!.id)).toMatchObject({
        status: 'failed',
        attempts: 1,
        last_error: 'webhook desativado',
      });
    } finally {
      await setWebhookB(true);
    }
  });

  it('URL trocada depois do lead: vai para a URL atual, assinada com o segredo atual', async () => {
    const leadId = await manualLead();
    const [, hook] = await deliveriesOf(leadId);
    const newUrl = 'https://hooks.exemplo.test/outro';
    await service
      .from('organization_settings')
      .update({ webhook_url: newUrl })
      .eq('organization_id', ORG_B);
    try {
      const [job] = await claim([hook!.id]);
      expect(job).toMatchObject({ url: newUrl, secret: secretB });
      expect((await delivery(hook!.id)).target).toBe(newUrl);
    } finally {
      await service
        .from('organization_settings')
        .update({ webhook_url: HOOK })
        .eq('organization_id', ORG_B);
    }
  });

  it('teste do webhook: uma tentativa só, com a organização e sem lead', async () => {
    const { data: id, error } = await adminB.rpc('enqueue_webhook_test', {
      p_organization_id: ORG_B,
    });
    expect(error).toBeNull();
    createdDeliveries.push(id as string);
    const [job] = await claim([id as string]);
    expect(job).toMatchObject({
      event: 'test',
      organization: { id: ORG_B, name: 'Construtora Teste' },
      url: HOOK,
    });
    expect(job).not.toHaveProperty('lead');
    expect(await complete(job!, false, 401, 'HTTP 401')).toBe('failed');
  });

  it('lead.deleted leva só o id do lead excluído', async () => {
    const leadId = await manualLead();
    const { error } = await adminB.rpc('delete_lead', { p_lead_id: leadId, p_reason: 'teste' });
    expect(error).toBeNull();
    const { data } = await service
      .from('notification_deliveries')
      .select('id')
      .eq('event', 'lead.deleted')
      .contains('payload', { lead: { id: leadId } });
    const id = data![0]!.id as string;
    createdDeliveries.push(id);
    const [job] = await claim([id]);
    expect(job).toMatchObject({ event: 'lead.deleted', lead: { id: leadId }, url: HOOK });
    expect(job).not.toHaveProperty('development');
  });
});

describe('acesso', () => {
  it('anon e usuários do painel não chamam a API de envio', async () => {
    for (const client of [anon, adminA, adminB]) {
      const calls = [
        client.rpc('claim_notification_deliveries', { p_channels: ['webhook'] }),
        client.rpc('complete_notification_delivery', {
          p_delivery_id: '00000000-0000-4000-8000-000000000000',
          p_attempt: 1,
          p_ok: true,
        }),
        client.rpc('check_notifications_dispatch_key', { p_key: 'x' }),
        client.rpc('set_notifications_paused', { p_paused: false }),
      ];
      for (const { error } of await Promise.all(calls)) {
        expect(error?.code).toBe('42501');
      }
    }
  });

  it('chave de acionamento errada é recusada', async () => {
    const { data } = await service.rpc('check_notifications_dispatch_key', { p_key: 'errada' });
    expect(data).toBe(false);
  });

  it('tentativas: membros leem as da própria organização; ninguém altera', async () => {
    const leadId = await manualLead();
    const [email] = await deliveriesOf(leadId);
    const [job] = await claim([email!.id]);
    await complete(job!, false, 500, 'Resend HTTP 500');

    const own = await adminB.from('notification_attempts').select('*').eq('delivery_id', email!.id);
    expect(own.data).toHaveLength(1);
    const cross = await adminA
      .from('notification_attempts')
      .select('*')
      .eq('delivery_id', email!.id);
    expect(cross.data).toEqual([]);
    expect(
      (await adminA.from('notification_attempts').select('organization_id')).data!.every(
        (a) => a.organization_id === ORG_A,
      ),
    ).toBe(true);

    const upd = await adminB
      .from('notification_attempts')
      .update({ ok: true })
      .eq('delivery_id', email!.id);
    expect(upd.error).not.toBeNull();
    const del = await adminB.from('notification_attempts').delete().eq('delivery_id', email!.id);
    expect(del.error).not.toBeNull();
    const svcUpd = await service
      .from('notification_attempts')
      .update({ ok: true })
      .eq('delivery_id', email!.id);
    expect(svcUpd.error).not.toBeNull();
  });
});
