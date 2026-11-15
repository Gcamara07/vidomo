import { describe, expect, it, vi } from 'vitest';
import type { LeadInput } from '../lead-form';
import { clientKeyFor, submitLead, type LeadRpcClient } from './submit';

const KEY = 'chave-de-teste-com-mais-de-32-caracteres';

const input = (patch: Partial<LeadInput> = {}): LeadInput => ({
  slug: 'residencial-vista',
  objectKey: 'TA__F08__U802',
  name: '  Maria   Souza ',
  phone: '(16) 99769-4880',
  email: ' Maria@Exemplo.com ',
  message: '  Quero visitar. ',
  consent: true,
  consentVersion: 'online-v1',
  source: 'unit_link',
  website: '',
  ...patch,
});

function fakeClient(result: { error: { code?: string; message?: string } | null }) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: result.error ? null : [{ lead_id: 'x', unit_code: '802' }],
    ...result,
  }));
  return { client: { rpc } as unknown as LeadRpcClient, rpc };
}

describe('submitLead (servidor)', () => {
  it('chama create_lead com a chave, o IP embaralhado e os campos limpos', async () => {
    const { client, rpc } = fakeClient({ error: null });
    const result = await submitLead(input(), { client, ingestKey: KEY, ip: '200.1.2.3' });
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('create_lead');
    expect(args).toEqual({
      p_ingest_key: KEY,
      p_client_key: clientKeyFor('200.1.2.3', KEY),
      p_slug: 'residencial-vista',
      p_object_key: 'TA__F08__U802',
      p_name: 'Maria Souza',
      p_phone: '16997694880',
      p_email: 'Maria@Exemplo.com',
      p_message: 'Quero visitar.',
      p_source: 'unit_link',
      p_consent: true,
      p_consent_version: 'online-v1',
    });
    // O IP nunca vai em claro.
    expect(JSON.stringify(args)).not.toContain('200.1.2.3');
    expect(args.p_client_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a chave do IP muda com a chave de ingestão (não dá para listar IPs sem ela)', () => {
    expect(clientKeyFor('200.1.2.3', KEY)).not.toBe(clientKeyFor('200.1.2.3', `${KEY}x`));
    expect(clientKeyFor('200.1.2.3', KEY)).not.toBe(clientKeyFor('200.1.2.4', KEY));
  });

  it('campo-armadilha preenchido: responde sucesso e não grava', async () => {
    const { client, rpc } = fakeClient({ error: null });
    const result = await submitLead(input({ website: 'http://spam.example' }), {
      client,
      ingestKey: KEY,
      ip: '1.1.1.1',
    });
    expect(result).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('valida antes de chamar o banco', async () => {
    const { client, rpc } = fakeClient({ error: null });
    expect(
      await submitLead(input({ consent: false }), { client, ingestKey: KEY, ip: '1.1.1.1' }),
    ).toEqual({ ok: false, error: 'consent_required', field: 'consent' });
    expect(
      await submitLead(input({ phone: '123' }), { client, ingestKey: KEY, ip: '1.1.1.1' }),
    ).toEqual({ ok: false, error: 'invalid_phone', field: 'phone' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('origem só portal ou unit_link; valores estranhos viram portal', async () => {
    const { client, rpc } = fakeClient({ error: null });
    await submitLead(input({ source: 'manual' as never }), { client, ingestKey: KEY, ip: '1' });
    expect(rpc.mock.calls[0]![1].p_source).toBe('portal');
  });

  it('limite antispam vira mensagem amigável', async () => {
    const { client } = fakeClient({ error: { code: 'VD429', message: 'rate_limited' } });
    expect(await submitLead(input(), { client, ingestKey: KEY, ip: '1.1.1.1' })).toEqual({
      ok: false,
      error: 'rate_limited',
    });
  });

  it('erro inesperado: registra só o código, sem dados do comprador', async () => {
    const log = vi.fn();
    const { client } = fakeClient({
      error: {
        code: '23514',
        message:
          'new row violates check constraint; Failing row contains (Maria Souza, 5516997694880)',
      },
    });
    const result = await submitLead(input(), { client, ingestKey: KEY, ip: '1.1.1.1', log });
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(log).toHaveBeenCalledWith('create_lead falhou: 23514');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Maria|5516/);
  });
});
