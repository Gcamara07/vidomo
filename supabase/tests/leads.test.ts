/**
 * Leads (Bloco 2, Etapa 1): criação pelo servidor, validações, antispam, consentimento,
 * papéis no painel, exclusão LGPD, configuração, segredo do webhook e Realtime.
 * O acesso cruzado entre organizações fica em isolation.test.ts.
 * Roda contra o Supabase local com o seed aplicado (`pnpm db:reset`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const { url, anonKey, serviceKey } = inject('supabase');
const PASSWORD = 'vidomo-dev-123';
/** Chave de ingestão SÓ do ambiente local (o hash está no seed.sql). */
const INGEST_KEY = 'vidomo-dev-ingest-key-somente-local-0001';
const SLUG_A = 'residencial-vista';
const SLUG_B = 'residencial-teste';
const ORG_A = 'a0000000-0000-4000-8000-0000000000a0';
const SALES_A = 'a0000000-0000-4000-8000-000000000002';

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (key = anonKey) => createClient(url, key, clientOptions);

async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`);
  return client;
}

const service = newClient(serviceKey);
const anon = newClient();
let adminA: SupabaseClient;
let salesA: SupabaseClient;
let adminB: SupabaseClient;
let adminAId: string;
let devAId: string;
let devBId: string;
let unit802Id: string;

// Valores aleatórios por execução: o limite antispam vale por hora e o banco é compartilhado.
const clientKey = () => randomBytes(16).toString('hex');
const phone = () => `(16) 9${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`;
const email = () => `comprador.${randomBytes(4).toString('hex')}@exemplo.test`;

type LeadArgs = Record<string, unknown>;
const leadArgs = (overrides: LeadArgs = {}): LeadArgs => ({
  p_ingest_key: INGEST_KEY,
  p_client_key: clientKey(),
  p_slug: SLUG_A,
  p_object_key: 'TA__F08__U802',
  p_name: 'Maria Souza',
  p_phone: phone(),
  p_email: null,
  p_message: null,
  p_source: 'unit_link',
  p_consent: true,
  p_consent_version: 'online-v1',
  ...overrides,
});

/** Cria pelo caminho do servidor (anon + chave de ingestão) e devolve o id. */
async function createLead(overrides: LeadArgs = {}): Promise<string> {
  const { data, error } = await anon.rpc('create_lead', leadArgs(overrides));
  if (error) throw new Error(`create_lead: ${error.message}`);
  return (data as { lead_id: string }[])[0]!.lead_id;
}

async function leadRow(id: string) {
  const { data, error } = await service.from('leads').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

const createdLeads: string[] = [];
/** Entregas que já existiam antes dos testes: o resto é apagado no fim. */
let deliveriesBefore = new Set<string>();
const TEST_HOOK = 'https://n8n.exemplo.test/webhook/vidomo';

/** Webhook da org A: URL e, se pedido, segredo gerado (webhook ativo = URL + segredo). */
async function setWebhook(url: string | null, withSecret: boolean) {
  const r = await service
    .from('organization_settings')
    .update({ webhook_url: url, webhook_secret_set_at: null })
    .eq('organization_id', ORG_A);
  if (r.error) throw r.error;
  if (withSecret) {
    const s = await adminA.rpc('rotate_webhook_secret', { p_organization_id: ORG_A });
    if (s.error) throw s.error;
  }
}

async function deliveryIds(): Promise<string[]> {
  const { data, error } = await service.from('notification_deliveries').select('id');
  if (error) throw error;
  return data.map((d) => d.id as string);
}

beforeAll(async () => {
  [adminA, salesA, adminB] = await Promise.all([
    signIn('admin@exemplo.test'),
    signIn('vendas@exemplo.test'),
    signIn('admin@teste.test'),
  ]);
  adminAId = (await adminA.auth.getUser()).data.user!.id;

  const { data: devs } = await service.from('developments').select('id, slug');
  devAId = devs!.find((d) => d.slug === SLUG_A)!.id;
  devBId = devs!.find((d) => d.slug === SLUG_B)!.id;
  const { data: u } = await service
    .from('units')
    .select('id')
    .eq('development_id', devAId)
    .eq('code', '802')
    .single();
  unit802Id = u!.id;

  deliveriesBefore = new Set(await deliveryIds());
  await setWebhook(null, false);
});

afterAll(async () => {
  // Leads criados aqui saem por exclusão direta da service_role (não precisam de registro LGPD).
  if (createdLeads.length) {
    const del = await service.from('leads').delete().in('id', createdLeads);
    if (del.error) throw del.error;
  }
  // lead.deleted e test não têm lead (não somem em cascata): apaga o que os testes criaram.
  const leftover = (await deliveryIds()).filter((id) => !deliveriesBefore.has(id));
  if (leftover.length) {
    const del = await service.from('notification_deliveries').delete().in('id', leftover);
    if (del.error) throw del.error;
  }
  const restore = await service
    .from('organization_settings')
    .update({
      webhook_url: null,
      webhook_secret_set_at: null,
      notification_emails: ['comercial@exemplo.test'],
    })
    .eq('organization_id', ORG_A);
  if (restore.error) throw restore.error;
  // Os testes não podem deixar entregas pendentes na fila.
  const remaining = (await deliveryIds()).filter((id) => !deliveriesBefore.has(id));
  if (remaining.length) throw new Error(`entregas deixadas pelos testes: ${remaining.join(', ')}`);
  await Promise.all([adminA, salesA, adminB].map((c) => c.auth.signOut()));
  await Promise.all([adminA, salesA, adminB, anon, service].map((c) => c.removeAllChannels()));
});

describe('create_lead (só o servidor do Next, com a chave de ingestão)', () => {
  it('grava o lead com telefone normalizado, consentimento, origem e unidade', async () => {
    const { data, error } = await anon.rpc(
      'create_lead',
      leadArgs({ p_phone: '(16) 99769-4880', p_message: '  Quero visitar.  ' }),
    );
    expect(error).toBeNull();
    const [row] = data as { lead_id: string; unit_code: string }[];
    expect(row!.unit_code).toBe('802');
    createdLeads.push(row!.lead_id);

    const lead = await leadRow(row!.lead_id);
    expect(lead).toMatchObject({
      organization_id: ORG_A,
      development_id: devAId,
      unit_id: unit802Id,
      name: 'Maria Souza',
      phone: '5516997694880',
      email: null,
      message: 'Quero visitar.',
      source: 'unit_link',
      status: 'new',
      assigned_to: null,
      consent_text_version: 'online-v1',
      created_by: null,
    });
    expect(lead!.consent_at).toBeTruthy();
  });

  it('aceita só e-mail (normalizado) e lead sem unidade pelo portal', async () => {
    const mail = email().toUpperCase();
    const { data, error } = await anon.rpc(
      'create_lead',
      leadArgs({ p_phone: '', p_email: `  ${mail} `, p_object_key: null, p_source: 'portal' }),
    );
    expect(error).toBeNull();
    const [row] = data as { lead_id: string; unit_code: string | null }[];
    createdLeads.push(row!.lead_id);
    expect(row!.unit_code).toBeNull();
    expect(await leadRow(row!.lead_id)).toMatchObject({
      phone: null,
      email: mail.toLowerCase(),
      unit_id: null,
      source: 'portal',
    });
  });

  it.each([
    ['sem chave', { p_ingest_key: null }],
    ['chave errada', { p_ingest_key: 'x'.repeat(40) }],
    ['chave curta', { p_ingest_key: 'curta' }],
  ])('recusa %s (42501) e não grava nada', async (_, overrides) => {
    const name = `Sem Chave ${randomBytes(3).toString('hex')}`;
    const { data, error } = await anon.rpc('create_lead', leadArgs({ ...overrides, p_name: name }));
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    const { data: rows } = await service.from('leads').select('id').eq('name', name);
    expect(rows).toEqual([]);
  });

  it.each([
    ['consentimento falso', { p_consent: false }, 'consent_required'],
    ['consentimento ausente', { p_consent: null }, 'consent_required'],
    [
      'versão presencial no online',
      { p_consent_version: 'presencial-v1' },
      'invalid_consent_version',
    ],
    ['versão inexistente', { p_consent_version: 'online-v99' }, 'invalid_consent_version'],
    ['sem telefone e sem e-mail', { p_phone: ' ', p_email: null }, 'contact_required'],
    ['telefone curto', { p_phone: '9999-999' }, 'invalid_phone'],
    ['telefone com DDD inválido', { p_phone: '(01) 99999-9999' }, 'invalid_phone'],
    ['e-mail inválido', { p_phone: null, p_email: 'nao-e-email' }, 'invalid_email'],
    ['nome curto', { p_name: ' A ' }, 'invalid_name'],
    ['nome longo', { p_name: 'x'.repeat(121) }, 'invalid_name'],
    ['mensagem longa', { p_message: 'x'.repeat(1001) }, 'message_too_long'],
    ['origem manual pela página', { p_source: 'manual' }, 'invalid_source'],
    ['origem stand pela página', { p_source: 'stand' }, 'invalid_source'],
    ['chave de cliente inválida', { p_client_key: 'curta' }, 'invalid_client_key'],
    ['empreendimento em rascunho', { p_slug: SLUG_B, p_object_key: null }, 'development_not_found'],
    ['empreendimento inexistente', { p_slug: 'nao-existe' }, 'development_not_found'],
    ['unidade de outro empreendimento', { p_object_key: 'TB__F01__U101' }, 'unit_not_found'],
  ])('recusa %s', async (_, overrides, message) => {
    const { data, error } = await anon.rpc('create_lead', leadArgs(overrides));
    expect(data).toBeNull();
    expect(error?.message).toBe(message);
    expect(error?.code).toMatch(/^VD4(22|04)$/);
  });
});

describe('antispam (no servidor)', () => {
  it('no máximo 5 por hora por IP', async () => {
    const ip = clientKey();
    for (let i = 0; i < 5; i++) createdLeads.push(await createLead({ p_client_key: ip }));
    const { error } = await anon.rpc('create_lead', leadArgs({ p_client_key: ip }));
    expect(error?.code).toBe('VD429');
    expect(error?.message).toBe('rate_limited');
    // Outro IP passa.
    createdLeads.push(await createLead());
  });

  it('no máximo 5 por hora pelo mesmo telefone, mesmo trocando de IP e de máscara', async () => {
    const digits = `16 9${randomInt(1000, 9999)} ${randomInt(1000, 9999)}`;
    const masks = [digits, `+55 ${digits}`, digits.replace(/\s/g, ''), `(${digits})`, digits];
    for (const p of masks) createdLeads.push(await createLead({ p_phone: p }));
    const { error } = await anon.rpc('create_lead', leadArgs({ p_phone: digits }));
    expect(error?.message).toBe('rate_limited');
  });

  it('no máximo 5 por hora pelo mesmo e-mail', async () => {
    const mail = email();
    for (let i = 0; i < 5; i++)
      createdLeads.push(await createLead({ p_phone: null, p_email: mail }));
    const { error } = await anon.rpc(
      'create_lead',
      leadArgs({ p_phone: null, p_email: mail.toUpperCase() }),
    );
    expect(error?.message).toBe('rate_limited');
  });

  it('não guarda IP, telefone nem e-mail em claro nas tentativas (tabela privada fora da API)', async () => {
    const { error } = await service
      .schema('private' as 'public')
      .from('lead_attempts')
      .select('*');
    expect(error).not.toBeNull();
  });
});

describe('fila de notificações', () => {
  async function deliveriesOf(leadId: string) {
    const { data } = await service
      .from('notification_deliveries')
      .select('channel, event, target, status, attempts')
      .eq('lead_id', leadId)
      .order('channel');
    return data;
  }

  it('lead novo enfileira o e-mail para os endereços configurados', async () => {
    const id = await createLead();
    createdLeads.push(id);
    expect(await deliveriesOf(id)).toEqual([
      {
        channel: 'email',
        event: 'lead.created',
        target: 'comercial@exemplo.test',
        status: 'pending',
        attempts: 0,
      },
    ]);
  });

  it('URL de webhook sem segredo gerado: só o e-mail (sem segredo não há como assinar)', async () => {
    await setWebhook(TEST_HOOK, false);
    const id = await createLead();
    createdLeads.push(id);
    expect((await deliveriesOf(id))!.map((d) => d.channel)).toEqual(['email']);
  });

  it('com webhook ativo (URL + segredo), enfileira e-mail e webhook', async () => {
    await setWebhook(TEST_HOOK, true);
    await adminA
      .from('organization_settings')
      .update({ notification_emails: ['comercial@exemplo.test', 'gerente@exemplo.test'] })
      .eq('organization_id', ORG_A);
    const id = await createLead();
    createdLeads.push(id);
    expect(await deliveriesOf(id)).toEqual([
      expect.objectContaining({
        channel: 'email',
        target: 'comercial@exemplo.test,gerente@exemplo.test',
      }),
      expect.objectContaining({
        channel: 'webhook',
        event: 'lead.created',
        target: 'https://n8n.exemplo.test/webhook/vidomo',
      }),
    ]);
  });
});

describe('comprador anônimo', () => {
  const tables = [
    'leads',
    'notification_deliveries',
    'organization_settings',
    'lead_deletions',
    'unit_whatsapp_clicks',
    'consent_texts',
  ];

  it.each(tables)('não faz SELECT, INSERT, UPDATE nem DELETE em %s', async (table) => {
    const sel = await anon.from(table).select('*');
    expect(sel.error).not.toBeNull();
    expect(sel.data).toBeNull();
    const ins = await anon.from(table).insert({ organization_id: ORG_A });
    expect(ins.error).not.toBeNull();
    const upd = await anon
      .from(table)
      .update({ organization_id: ORG_A })
      .eq('organization_id', ORG_A);
    expect(upd.error).not.toBeNull();
    const del = await anon.from(table).delete().eq('organization_id', ORG_A);
    expect(del.error).not.toBeNull();
  });

  it.each([
    ['claim_lead', { p_lead_id: '00000000-0000-0000-0000-000000000000' }],
    ['set_lead_status', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_status: 'won' }],
    ['delete_lead', { p_lead_id: '00000000-0000-0000-0000-000000000000' }],
    ['rotate_webhook_secret', { p_organization_id: ORG_A }],
  ])('não chama %s', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error).not.toBeNull();
  });

  it('lê o contato público: WhatsApp, política e texto de consentimento (sem e-mails nem webhook)', async () => {
    const { data, error } = await anon.rpc('public_contact', { p_slug: SLUG_A });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = (data as Record<string, string | null>[])[0]!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'consent_text',
        'consent_version',
        'organization_name',
        'privacy_policy_url',
        'whatsapp_number',
      ].sort(),
    );
    expect(row.organization_name).toBe('Construtora Exemplo');
    expect(row.whatsapp_number).toBe('5516997694880');
    expect(row.consent_version).toBe('online-v1');
    expect(row.consent_text).toContain('Autorizo a Construtora Exemplo');
    expect(row.consent_text).not.toContain('{organizacao}');

    const draft = await anon.rpc('public_contact', { p_slug: SLUG_B });
    expect(draft.data).toEqual([]);
  });

  it('registra clique no WhatsApp só como contagem por unidade e dia', async () => {
    const before = await service
      .from('unit_whatsapp_clicks')
      .select('clicks')
      .eq('unit_id', unit802Id);
    const total = (rows: { clicks: number }[] | null) =>
      (rows ?? []).reduce((s, r) => s + r.clicks, 0);

    for (let i = 0; i < 2; i++) {
      const { data } = await anon.rpc('register_whatsapp_click', {
        p_slug: SLUG_A,
        p_object_key: 'TA__F08__U802',
      });
      expect(data).toBe(true);
    }
    const after = await service
      .from('unit_whatsapp_clicks')
      .select('clicks')
      .eq('unit_id', unit802Id);
    expect(total(after.data) - total(before.data)).toBe(2);

    const draft = await anon.rpc('register_whatsapp_click', {
      p_slug: SLUG_B,
      p_object_key: 'TB__F01__U101',
    });
    expect(draft.data).toBe(false);

    // Membros leem a contagem.
    const mine = await salesA
      .from('unit_whatsapp_clicks')
      .select('clicks')
      .eq('unit_id', unit802Id);
    expect(total(mine.data)).toBe(total(after.data));
  });
});

describe('painel: vendedor e admin', () => {
  it('vendedor lê os leads da organização (e só dela)', async () => {
    createdLeads.push(await createLead());
    const { data, error } = await salesA.from('leads').select('id, organization_id');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(new Set(data!.map((l) => l.organization_id))).toEqual(new Set([ORG_A]));
  });

  it('ninguém escreve direto na tabela de leads (só por função)', async () => {
    const id = await createLead();
    createdLeads.push(id);
    const upd = await adminA.from('leads').update({ status: 'won' }).eq('id', id);
    expect(upd.error).not.toBeNull();
    const del = await adminA.from('leads').delete().eq('id', id);
    expect(del.error).not.toBeNull();
    const ins = await adminA.from('leads').insert({ name: 'Direto' });
    expect(ins.error).not.toBeNull();
    expect((await leadRow(id))!.status).toBe('new');
  });

  it('vendedor assume lead sem dono; ninguém assume lead que já tem dono', async () => {
    const id = await createLead();
    createdLeads.push(id);
    const claim = await salesA.rpc('claim_lead', { p_lead_id: id });
    expect(claim.error).toBeNull();
    expect(claim.data).toMatchObject({ id, assigned_to: SALES_A });

    // Assumir de novo o próprio lead é inofensivo.
    expect((await salesA.rpc('claim_lead', { p_lead_id: id })).error).toBeNull();

    const steal = await adminA.rpc('claim_lead', { p_lead_id: id });
    expect(steal.error?.code).toBe('VD409');
    expect((await leadRow(id))!.assigned_to).toBe(SALES_A);
  });

  it('vendedor muda status só dos leads dele; admin muda de qualquer um', async () => {
    const mine = await createLead();
    const unassigned = await createLead();
    const admins = await createLead();
    createdLeads.push(mine, unassigned, admins);
    await salesA.rpc('claim_lead', { p_lead_id: mine });
    await adminA.rpc('claim_lead', { p_lead_id: admins });

    const ok = await salesA.rpc('set_lead_status', { p_lead_id: mine, p_status: 'in_progress' });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ status: 'in_progress' });

    for (const id of [unassigned, admins]) {
      const denied = await salesA.rpc('set_lead_status', { p_lead_id: id, p_status: 'won' });
      expect(denied.error?.code).toBe('42501');
      expect((await leadRow(id))!.status).toBe('new');
    }

    for (const [id, status] of [
      [mine, 'won'],
      [unassigned, 'lost'],
    ] as const) {
      const r = await adminA.rpc('set_lead_status', { p_lead_id: id, p_status: status });
      expect(r.error).toBeNull();
      expect((await leadRow(id))!.status).toBe(status);
    }
  });

  it('só o admin atribui, e só a membros da organização', async () => {
    const id = await createLead();
    createdLeads.push(id);
    const bySales = await salesA.rpc('assign_lead', { p_lead_id: id, p_user_id: SALES_A });
    expect(bySales.error?.code).toBe('42501');

    const outsider = (await adminB.auth.getUser()).data.user!.id;
    const toOutsider = await adminA.rpc('assign_lead', { p_lead_id: id, p_user_id: outsider });
    expect(toOutsider.error?.message).toBe('not_a_member');

    const ok = await adminA.rpc('assign_lead', { p_lead_id: id, p_user_id: SALES_A });
    expect(ok.error).toBeNull();
    expect((await leadRow(id))!.assigned_to).toBe(SALES_A);

    const back = await adminA.rpc('assign_lead', { p_lead_id: id, p_user_id: adminAId });
    expect(back.error).toBeNull();
    const none = await adminA.rpc('assign_lead', { p_lead_id: id, p_user_id: null });
    expect(none.error).toBeNull();
    expect((await leadRow(id))!.assigned_to).toBeNull();
  });
});

describe('lead manual (painel)', () => {
  it('exige consentimento presencial marcado', async () => {
    const { error } = await salesA.rpc('create_manual_lead', {
      p_development_id: devAId,
      p_unit_id: unit802Id,
      p_name: 'João Balcão',
      p_phone: phone(),
      p_email: null,
      p_message: null,
      p_consent_in_person: false,
    });
    expect(error?.message).toBe('consent_required');
  });

  it('grava origem manual, consentimento presencial e fica com quem cadastrou', async () => {
    const { data, error } = await salesA.rpc('create_manual_lead', {
      p_development_id: devAId,
      p_unit_id: unit802Id,
      p_name: 'João Balcão',
      p_phone: null,
      p_email: email(),
      p_message: 'Visitou o estande.',
      p_consent_in_person: true,
    });
    expect(error).toBeNull();
    createdLeads.push((data as { id: string }).id);
    expect(data).toMatchObject({
      source: 'manual',
      consent_text_version: 'presencial-v1',
      assigned_to: SALES_A,
      created_by: SALES_A,
      unit_id: unit802Id,
    });
  });

  it('também exige telefone ou e-mail', async () => {
    const { error } = await salesA.rpc('create_manual_lead', {
      p_development_id: devAId,
      p_unit_id: null,
      p_name: 'Sem Contato',
      p_phone: null,
      p_email: null,
      p_message: null,
      p_consent_in_person: true,
    });
    expect(error?.message).toBe('contact_required');
  });

  it('não cadastra em empreendimento de outra organização nem com unidade de outro empreendimento', async () => {
    const base = {
      p_name: 'Fora',
      p_phone: phone(),
      p_email: null,
      p_message: null,
      p_consent_in_person: true,
    };
    const other = await salesA.rpc('create_manual_lead', {
      ...base,
      p_development_id: devBId,
      p_unit_id: null,
    });
    expect(other.error?.message).toBe('development_not_found');

    const { data: unitB } = await service
      .from('units')
      .select('id')
      .eq('development_id', devBId)
      .limit(1)
      .single();
    const wrongUnit = await salesA.rpc('create_manual_lead', {
      ...base,
      p_development_id: devAId,
      p_unit_id: unitB!.id,
    });
    expect(wrongUnit.error?.message).toBe('unit_not_found');
  });
});

describe('exclusão a pedido do titular (LGPD)', () => {
  it('vendedor não exclui', async () => {
    const id = await createLead();
    createdLeads.push(id);
    const { error } = await salesA.rpc('delete_lead', { p_lead_id: id, p_reason: 'teste' });
    expect(error?.code).toBe('42501');
    expect(await leadRow(id)).not.toBeNull();
  });

  it('webhook sem segredo: a exclusão não enfileira lead.deleted (mesma regra do lead.created)', async () => {
    await setWebhook(TEST_HOOK, false);
    const id = await createLead();
    const { error } = await adminA.rpc('delete_lead', { p_lead_id: id, p_reason: 'teste' });
    expect(error).toBeNull();
    const { data } = await service
      .from('notification_deliveries')
      .select('id')
      .eq('event', 'lead.deleted')
      .contains('payload', { lead: { id } });
    expect(data).toEqual([]);
  });

  it('admin exclui: lead e entregas somem, fica registro sem dado pessoal e sai lead.deleted', async () => {
    await setWebhook(TEST_HOOK, true);
    const id = await createLead({ p_email: email(), p_message: 'Apague meus dados depois.' });
    const { data: queued } = await service
      .from('notification_deliveries')
      .select('id')
      .eq('lead_id', id);
    expect(queued!.length).toBe(2);

    const { error } = await adminA.rpc('delete_lead', {
      p_lead_id: id,
      p_reason: 'pedido do titular por e-mail',
    });
    expect(error).toBeNull();

    expect(await leadRow(id)).toBeNull();
    const { data: left } = await service
      .from('notification_deliveries')
      .select('id')
      .eq('lead_id', id);
    expect(left).toEqual([]);

    const { data: log } = await adminA
      .from('lead_deletions')
      .select('*')
      .eq('lead_id', id)
      .single();
    expect(Object.keys(log!).sort()).toEqual(
      [
        'deleted_at',
        'deleted_by',
        'development_id',
        'id',
        'lead_created_at',
        'lead_id',
        'organization_id',
        'reason',
        'source',
      ].sort(),
    );
    expect(log).toMatchObject({
      organization_id: ORG_A,
      reason: 'pedido do titular por e-mail',
      deleted_by: adminAId,
      source: 'unit_link',
    });

    const { data: deleted } = await service
      .from('notification_deliveries')
      .select('channel, event, target, payload, lead_id')
      .eq('event', 'lead.deleted')
      .contains('payload', { lead: { id } });
    expect(deleted).toEqual([
      {
        channel: 'webhook',
        event: 'lead.deleted',
        target: 'https://n8n.exemplo.test/webhook/vidomo',
        payload: { lead: { id } },
        lead_id: null,
      },
    ]);

    // Vendedor não lê o registro de exclusões; ninguém o altera.
    const sales = await salesA.from('lead_deletions').select('id').eq('lead_id', id);
    expect(sales.data).toEqual([]);
    const tamper = await service.from('lead_deletions').update({ reason: 'x' }).eq('lead_id', id);
    expect(tamper.error?.message).toMatch(/imutável/);
  });
});

describe('configuração e segredo do webhook', () => {
  it('admin edita; e-mail inválido é recusado; vendedor lê mas não altera', async () => {
    const bad = await adminA
      .from('organization_settings')
      .update({ notification_emails: ['nao-e-email'] })
      .eq('organization_id', ORG_A);
    expect(bad.error).not.toBeNull();

    const badPhone = await adminA
      .from('organization_settings')
      .update({ whatsapp_number: '16997694880' }) // sem DDI: o servidor normaliza antes
      .eq('organization_id', ORG_A);
    expect(badPhone.error).not.toBeNull();

    const read = await salesA
      .from('organization_settings')
      .select('*')
      .eq('organization_id', ORG_A);
    expect(read.data).toHaveLength(1);
    // Nenhuma coluna guarda o segredo.
    expect(Object.keys(read.data![0]!).some((k) => /secret$/.test(k))).toBe(false);

    const bySales = await salesA
      .from('organization_settings')
      .update({ whatsapp_number: '5511999999999' })
      .eq('organization_id', ORG_A)
      .select();
    expect(bySales.data ?? []).toEqual([]);
    const { data: now } = await service
      .from('organization_settings')
      .select('whatsapp_number')
      .eq('organization_id', ORG_A)
      .single();
    expect(now!.whatsapp_number).toBe('5516997694880');

    const direct = await adminA
      .from('organization_settings')
      .update({ webhook_secret_set_at: new Date().toISOString() })
      .eq('organization_id', ORG_A);
    expect(direct.error).not.toBeNull();
  });

  it('só o admin da própria organização gera o segredo; ele aparece uma vez e troca a cada geração', async () => {
    const bySales = await salesA.rpc('rotate_webhook_secret', { p_organization_id: ORG_A });
    expect(bySales.error?.code).toBe('42501');
    const cross = await adminB.rpc('rotate_webhook_secret', { p_organization_id: ORG_A });
    expect(cross.error?.code).toBe('42501');

    const first = await adminA.rpc('rotate_webhook_secret', { p_organization_id: ORG_A });
    expect(first.error).toBeNull();
    expect(first.data).toMatch(/^whsec_[0-9a-f]{64}$/);
    const second = await adminA.rpc('rotate_webhook_secret', { p_organization_id: ORG_A });
    expect(second.data).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(second.data).not.toBe(first.data);

    const { data } = await adminA
      .from('organization_settings')
      .select('webhook_secret_set_at')
      .eq('organization_id', ORG_A)
      .single();
    expect(data!.webhook_secret_set_at).toBeTruthy();

    // O Vault não é exposto pela API, nem para a service_role.
    const vault = await service
      .schema('vault' as 'public')
      .from('decrypted_secrets')
      .select('*');
    expect(vault.error).not.toBeNull();
  });

  it('"Enviar teste": só admin, só com webhook ativo, e enfileira uma entrega test', async () => {
    await setWebhook(null, false);
    const inactive = await adminA.rpc('enqueue_webhook_test', { p_organization_id: ORG_A });
    expect(inactive.error?.message).toBe('webhook_inactive');

    await setWebhook(TEST_HOOK, false);
    const noSecret = await adminA.rpc('enqueue_webhook_test', { p_organization_id: ORG_A });
    expect(noSecret.error?.message).toBe('webhook_inactive');

    await setWebhook(TEST_HOOK, true);
    const bySales = await salesA.rpc('enqueue_webhook_test', { p_organization_id: ORG_A });
    expect(bySales.error?.code).toBe('42501');
    const cross = await adminB.rpc('enqueue_webhook_test', { p_organization_id: ORG_A });
    expect(cross.error?.code).toBe('42501');

    const ok = await adminA.rpc('enqueue_webhook_test', { p_organization_id: ORG_A });
    expect(ok.error).toBeNull();
    // O admin acompanha a entrega pelo painel (RLS de membros).
    const { data } = await adminA
      .from('notification_deliveries')
      .select('channel, event, target, status, lead_id')
      .eq('id', ok.data as string)
      .single();
    expect(data).toEqual({
      channel: 'webhook',
      event: 'test',
      target: TEST_HOOK,
      status: 'pending',
      lead_id: null,
    });
    await setWebhook(null, false);
  });

  it('textos de consentimento são imutáveis', async () => {
    const upd = await service
      .from('consent_texts')
      .update({ body: 'outro' })
      .eq('version', 'online-v1');
    expect(upd.error?.message).toMatch(/imutável/);
  });
});

describe('Realtime de leads no painel', () => {
  function listen(client: SupabaseClient, name: string) {
    const inserts: { new: { id?: string; organization_id?: string } }[] = [];
    const channel = client
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (p) =>
        inserts.push(p as (typeof inserts)[number]),
      );
    const ready = new Promise<string>((resolve) => {
      channel.on('system', {}, (msg: { extension?: string; status?: string }) => {
        if (msg.extension === 'postgres_changes') resolve(msg.status ?? 'unknown');
      });
      channel.subscribe((s) => {
        if (s !== 'SUBSCRIBED' && s !== 'CLOSED') resolve(s);
      });
    });
    return { inserts, ready };
  }

  it('vendedor da org A recebe o lead novo; admin da org B não recebe nada', async () => {
    salesA.realtime.setAuth((await salesA.auth.getSession()).data.session!.access_token);
    adminB.realtime.setAuth((await adminB.auth.getSession()).data.session!.access_token);
    const a = listen(salesA, 'leads-a');
    const b = listen(adminB, 'leads-b');
    expect(await a.ready).toBe('ok');
    expect(await b.ready).toBe('ok');

    const id = await createLead();
    createdLeads.push(id);

    const start = Date.now();
    while (!a.inserts.some((c) => c.new.id === id) && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(a.inserts.some((c) => c.new.id === id)).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    expect(b.inserts).toEqual([]);
  });
});
