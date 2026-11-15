import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  DEFAULT_FILTERS,
  canChangeStatus,
  csvCell,
  csvFileName,
  filterLeads,
  formatPhone,
  leadFromRow,
  leadsToCsv,
  panelErrorMessage,
  sellerWhatsappMessage,
  upsertLead,
  validateManualLead,
  type PanelLead,
} from './leads';

const lead = (patch: Partial<PanelLead> = {}): PanelLead => ({
  id: 'l1',
  organizationId: 'org',
  developmentId: 'dev',
  unitId: 'u802',
  name: 'Maria Souza',
  phone: '5516997694880',
  email: null,
  message: null,
  source: 'unit_link',
  status: 'new',
  assignedTo: null,
  consentAt: '2026-11-15T13:00:00Z',
  consentVersion: 'online-v1',
  createdAt: '2026-11-15T13:00:00Z',
  ...patch,
});

describe('lista e filtros', () => {
  const list = [
    lead({ id: 'a', status: 'new', source: 'portal' }),
    lead({ id: 'b', status: 'in_progress', assignedTo: 'me' }),
    lead({ id: 'c', status: 'won', source: 'manual', assignedTo: 'other', developmentId: 'dev2' }),
  ];

  it('sem filtro, tudo', () => {
    expect(filterLeads(list, DEFAULT_FILTERS, 'me').map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it.each([
    [{ status: 'new' as const }, ['a']],
    [{ source: 'manual' as const }, ['c']],
    [{ mine: true }, ['b']],
    [{ developmentId: 'dev2' }, ['c']],
    [{ status: 'won' as const, mine: true }, []],
  ])('%j → %j', (patch, ids) => {
    expect(filterLeads(list, { ...DEFAULT_FILTERS, ...patch }, 'me').map((l) => l.id)).toEqual(ids);
  });

  it('lead novo entra no topo e o Realtime repetido não duplica', () => {
    const newer = lead({ id: 'z', createdAt: '2026-11-15T14:00:00Z' });
    const once = upsertLead(list, newer);
    expect(once[0]!.id).toBe('z');
    expect(upsertLead(once, { ...newer, status: 'won' }).filter((l) => l.id === 'z')).toEqual([
      { ...newer, status: 'won' },
    ]);
  });

  it('status: admin sempre; vendedor só nos dele', () => {
    expect(canChangeStatus(lead({ assignedTo: 'other' }), 'me', true)).toBe(true);
    expect(canChangeStatus(lead({ assignedTo: 'me' }), 'me', false)).toBe(true);
    expect(canChangeStatus(lead({ assignedTo: null }), 'me', false)).toBe(false);
    expect(canChangeStatus(lead({ assignedTo: 'other' }), 'me', false)).toBe(false);
  });

  it('converte a linha do banco (API ou Realtime)', () => {
    expect(
      leadFromRow({
        id: 'x',
        organization_id: 'o',
        development_id: 'd',
        unit_id: null,
        name: 'Ana',
        phone: null,
        email: 'ana@exemplo.com',
        message: 'Oi',
        source: 'manual',
        status: 'won',
        assigned_to: 'u',
        consent_at: 't1',
        consent_text_version: 'presencial-v1',
        created_at: 't0',
      }),
    ).toEqual({
      id: 'x',
      organizationId: 'o',
      developmentId: 'd',
      unitId: null,
      name: 'Ana',
      phone: null,
      email: 'ana@exemplo.com',
      message: 'Oi',
      source: 'manual',
      status: 'won',
      assignedTo: 'u',
      consentAt: 't1',
      consentVersion: 'presencial-v1',
      createdAt: 't0',
    });
  });
});

describe('contato', () => {
  it.each([
    ['5516997694880', '(16) 99769-4880'],
    ['551633334444', '(16) 3333-4444'],
    [null, ''],
  ])('%j → %j', (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  it('mensagem do vendedor no WhatsApp', () => {
    expect(
      sellerWhatsappMessage({
        leadName: 'Maria Souza',
        sellerName: 'Vendedor Exemplo',
        organizationName: 'Construtora Exemplo',
        developmentName: 'Residencial Vista',
        unitCode: '802',
      }),
    ).toBe(
      'Olá, Maria! Aqui é Vendedor, da Construtora Exemplo. Recebi o seu interesse no apartamento 802 do Residencial Vista. Podemos conversar?',
    );
    expect(
      sellerWhatsappMessage({
        leadName: 'Ana',
        sellerName: null,
        organizationName: 'Construtora Exemplo',
        developmentName: 'Residencial Vista',
        unitCode: null,
      }),
    ).toBe(
      'Olá, Ana! Aqui é da Construtora Exemplo. Recebi o seu interesse no Residencial Vista. Podemos conversar?',
    );
  });
});

describe('CSV', () => {
  it.each([
    ['simples', 'simples'],
    ['com; ponto e vírgula', '"com; ponto e vírgula"'],
    ['com "aspas"', '"com ""aspas"""'],
    ['duas\nlinhas', '"duas\nlinhas"'],
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+5516', "'+5516"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    [null, ''],
  ])('célula %j → %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('BOM, cabeçalho em português, ";" e uma linha por lead, sem fórmula', () => {
    const csv = leadsToCsv(
      [
        lead({
          name: '=cmd',
          email: 'maria@exemplo.com',
          message: 'Quero visitar; sábado',
          assignedTo: 'u1',
        }),
      ],
      {
        unitCode: (id) => (id === 'u802' ? '802' : ''),
        developmentName: () => 'Residencial Vista',
        memberName: (id) => (id === 'u1' ? 'Vendedor Exemplo' : ''),
      },
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(';'));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '15/11/2026, 10:00;\'=cmd;(16) 99769-4880;maria@exemplo.com;"Quero visitar; sábado";Residencial Vista;802;Link da unidade;Novo;Vendedor Exemplo;15/11/2026, 10:00;online-v1',
    );
  });

  it('nome do arquivo com a data de São Paulo', () => {
    expect(csvFileName(new Date('2026-11-16T01:30:00Z'))).toBe('leads-2026-11-15.csv');
  });
});

describe('lead manual e erros', () => {
  const ok = {
    name: 'João Balcão',
    phone: '',
    email: 'joao@exemplo.com',
    message: '',
    consentInPerson: true,
  };
  it('aceita só e-mail ou só telefone', () => {
    expect(validateManualLead(ok)).toBeNull();
    expect(validateManualLead({ ...ok, email: '', phone: '(16) 99769-4880' })).toBeNull();
  });
  it.each([
    [{ name: 'J' }, 'name'],
    [{ email: '', phone: '' }, 'phone'],
    [{ phone: '123' }, 'phone'],
    [{ email: 'x@' }, 'email'],
    [{ consentInPerson: false }, 'consentInPerson'],
  ])('%j → %s', (patch, field) => {
    expect(validateManualLead({ ...ok, ...patch })?.field).toBe(field);
  });
  it('traduz erros das RPCs', () => {
    expect(panelErrorMessage({ code: 'VD409', message: 'already_assigned' })).toBe(
      'Outra pessoa já assumiu este lead.',
    );
    expect(panelErrorMessage({ code: 'XX', message: 'qualquer' })).toBe(
      'Não foi possível concluir agora. Tente de novo.',
    );
  });
});
