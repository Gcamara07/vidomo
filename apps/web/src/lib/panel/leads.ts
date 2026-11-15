/**
 * Painel de leads: tipos, rótulos, filtros, CSV e mensagem de WhatsApp do vendedor.
 * Funções puras (testadas em leads.test.ts); a tela só junta as peças.
 */
import {
  LEAD_ERROR_MESSAGES,
  MESSAGE_MAX,
  NAME_MAX,
  cleanName,
  isValidBrPhone,
  isValidEmail,
} from '../lead-form';

export const LEAD_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['portal', 'unit_link', 'stand', 'manual'] as const;
export type LeadSourceAll = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  in_progress: 'Em atendimento',
  won: 'Convertido',
  lost: 'Perdido',
};

export const LEAD_SOURCE_LABELS: Record<LeadSourceAll, string> = {
  portal: 'Portal',
  unit_link: 'Link da unidade',
  stand: 'Estande',
  manual: 'Manual',
};

export interface PanelLead {
  id: string;
  organizationId: string;
  developmentId: string;
  unitId: string | null;
  name: string;
  /** Só dígitos com DDI (5516…). */
  phone: string | null;
  email: string | null;
  message: string | null;
  source: LeadSourceAll;
  status: LeadStatus;
  assignedTo: string | null;
  consentAt: string;
  consentVersion: string;
  createdAt: string;
}

/** Linha de public.leads (API ou Realtime) → lead do painel. */
export function leadFromRow(row: Record<string, unknown>): PanelLead {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    developmentId: String(row.development_id),
    unitId: (row.unit_id as string | null) ?? null,
    name: String(row.name ?? ''),
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    source: row.source as LeadSourceAll,
    status: row.status as LeadStatus,
    assignedTo: (row.assigned_to as string | null) ?? null,
    consentAt: String(row.consent_at ?? ''),
    consentVersion: String(row.consent_text_version ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

export const LEAD_COLUMNS =
  'id, organization_id, development_id, unit_id, name, phone, email, message, source, status, assigned_to, consent_at, consent_text_version, created_at';

export interface LeadFilters {
  status: LeadStatus | 'all';
  source: LeadSourceAll | 'all';
  /** Só os leads assumidos por quem está logado. */
  mine: boolean;
  developmentId: string | 'all';
}

export const DEFAULT_FILTERS: LeadFilters = {
  status: 'all',
  source: 'all',
  mine: false,
  developmentId: 'all',
};

export function filterLeads(leads: PanelLead[], f: LeadFilters, userId: string): PanelLead[] {
  return leads.filter(
    (l) =>
      (f.status === 'all' || l.status === f.status) &&
      (f.source === 'all' || l.source === f.source) &&
      (!f.mine || l.assignedTo === userId) &&
      (f.developmentId === 'all' || l.developmentId === f.developmentId),
  );
}

/** Mais novos primeiro; sem repetir id (Realtime pode reentregar). */
export function upsertLead(list: PanelLead[], lead: PanelLead): PanelLead[] {
  const rest = list.filter((l) => l.id !== lead.id);
  return [lead, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pode mudar o status? Admin sempre; vendedor só nos leads dele (regra do banco). */
export function canChangeStatus(lead: PanelLead, userId: string, isAdmin: boolean): boolean {
  return isAdmin || lead.assignedTo === userId;
}

/** 5516997694880 → (16) 99769-4880. */
export function formatPhone(phone: string | null): string {
  if (!phone) return '';
  const d = phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : phone;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Mensagem pronta para o vendedor abrir a conversa com o lead. */
export function sellerWhatsappMessage(p: {
  leadName: string;
  sellerName: string | null;
  organizationName: string;
  developmentName: string;
  unitCode: string | null;
}): string {
  const who = p.sellerName
    ? `Aqui é ${firstName(p.sellerName)}, da ${p.organizationName}`
    : `Aqui é da ${p.organizationName}`;
  const about = p.unitCode
    ? `o seu interesse no apartamento ${p.unitCode} do ${p.developmentName}`
    : `o seu interesse no ${p.developmentName}`;
  return `Olá, ${firstName(p.leadName)}! ${who}. Recebi ${about}. Podemos conversar?`;
}

// ------------------------------------------------------------------------------- CSV

export interface CsvContext {
  unitCode: (unitId: string | null) => string;
  developmentName: (developmentId: string) => string;
  memberName: (userId: string | null) => string;
}

/**
 * Célula segura: aspas duplicadas, e fórmula neutralizada (planilhas executam células que
 * começam com = + - @, e o nome e a mensagem vêm do público).
 */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[";\n\r]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Marca de ordem de bytes: o Excel só abre o CSV como UTF-8 (acentos) com ela. */
export const BOM = String.fromCharCode(0xfeff);

export const CSV_HEADER = [
  'Data',
  'Nome',
  'Telefone',
  'E-mail',
  'Mensagem',
  'Empreendimento',
  'Unidade',
  'Origem',
  'Status',
  'Responsável',
  'Consentimento em',
  'Versão do consentimento',
];

/**
 * CSV para Excel em português: separador ";", BOM UTF-8 e quebra de linha CRLF.
 * Exporta exatamente a lista passada (a tela passa a lista já filtrada).
 */
export function leadsToCsv(leads: PanelLead[], ctx: CsvContext): string {
  const rows = leads.map((l) =>
    [
      dateTime.format(new Date(l.createdAt)),
      l.name,
      formatPhone(l.phone),
      l.email,
      l.message,
      ctx.developmentName(l.developmentId),
      ctx.unitCode(l.unitId),
      LEAD_SOURCE_LABELS[l.source],
      LEAD_STATUS_LABELS[l.status],
      ctx.memberName(l.assignedTo),
      l.consentAt ? dateTime.format(new Date(l.consentAt)) : '',
      l.consentVersion,
    ]
      .map(csvCell)
      .join(';'),
  );
  return `${BOM}${[CSV_HEADER.join(';'), ...rows].join('\r\n')}\r\n`;
}

export function csvFileName(now = new Date()): string {
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(now);
  return `leads-${d}.csv`;
}

// ----------------------------------------------------------------- erros e lead manual

/** Erro de RPC do painel → frase para a tela. */
export function panelErrorMessage(error: { code?: string; message?: string } | null): string {
  const m = error?.message ?? '';
  const known: Record<string, string> = {
    already_assigned: 'Outra pessoa já assumiu este lead.',
    not_assigned_to_you: 'Assuma o lead para mudar o status.',
    admin_required: 'Só administradores podem fazer isso.',
    lead_not_found: 'Lead não encontrado (pode ter sido excluído).',
    not_a_member: 'Essa pessoa não faz parte da equipe.',
    development_not_found: 'Empreendimento não encontrado.',
    unit_not_found: 'Unidade não encontrada neste empreendimento.',
    consent_required: 'Marque o consentimento obtido presencialmente.',
    contact_required: 'Informe telefone ou e-mail.',
    invalid_name: LEAD_ERROR_MESSAGES.invalid_name,
    invalid_phone: LEAD_ERROR_MESSAGES.invalid_phone,
    invalid_email: 'Confira o e-mail.',
    message_too_long: LEAD_ERROR_MESSAGES.message_too_long,
    reason_too_long: 'O motivo pode ter até 300 caracteres.',
    webhook_inactive: 'Salve a URL do webhook e gere o segredo antes de enviar o teste.',
  };
  return known[m] ?? 'Não foi possível concluir agora. Tente de novo.';
}

export interface ManualLeadInput {
  name: string;
  phone: string;
  email: string;
  message: string;
  consentInPerson: boolean;
}

/** Lead manual: telefone OU e-mail, consentimento presencial marcado (regra do banco). */
export function validateManualLead(
  i: ManualLeadInput,
): { field: keyof ManualLeadInput; message: string } | null {
  const name = cleanName(i.name);
  if (name.length < 2 || name.length > NAME_MAX)
    return { field: 'name', message: LEAD_ERROR_MESSAGES.invalid_name };
  const hasPhone = i.phone.trim() !== '';
  const hasEmail = i.email.trim() !== '';
  if (!hasPhone && !hasEmail) return { field: 'phone', message: 'Informe telefone ou e-mail.' };
  if (hasPhone && !isValidBrPhone(i.phone))
    return { field: 'phone', message: LEAD_ERROR_MESSAGES.invalid_phone };
  if (hasEmail && !isValidEmail(i.email)) return { field: 'email', message: 'Confira o e-mail.' };
  if (i.message.trim().length > MESSAGE_MAX)
    return { field: 'message', message: LEAD_ERROR_MESSAGES.message_too_long };
  if (!i.consentInPerson)
    return { field: 'consentInPerson', message: 'Marque o consentimento obtido presencialmente.' };
  return null;
}
