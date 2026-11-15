/**
 * Formulário de interesse: máscara, normalização e validação compartilhadas entre o
 * navegador (mensagens na hora) e o servidor (antes de chamar o banco). O banco
 * (create_lead) valida de novo e é quem decide.
 */

export type LeadSource = 'portal' | 'unit_link';

export interface LeadInput {
  slug: string;
  objectKey: string | null;
  name: string;
  phone: string;
  email: string;
  message: string;
  consent: boolean;
  consentVersion: string;
  source: LeadSource;
  /** Campo-armadilha: pessoas não veem; robôs preenchem. */
  website?: string;
}

export type LeadField = 'name' | 'phone' | 'email' | 'message' | 'consent';

export type LeadErrorCode =
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_email'
  | 'message_too_long'
  | 'consent_required'
  | 'rate_limited'
  | 'unavailable'
  | 'unknown';

export type LeadResult = { ok: true } | { ok: false; error: LeadErrorCode; field?: LeadField };

export const NAME_MAX = 120;
export const MESSAGE_MAX = 1000;
export const EMAIL_MAX = 254;

/** Mensagens para o comprador (sem jargão, sem culpar). */
export const LEAD_ERROR_MESSAGES: Record<LeadErrorCode, string> = {
  invalid_name: 'Informe seu nome.',
  invalid_phone: 'Informe um telefone com DDD, por exemplo (16) 99769-4880.',
  invalid_email: 'Confira o e-mail ou deixe o campo em branco.',
  message_too_long: `A mensagem pode ter até ${MESSAGE_MAX} caracteres.`,
  consent_required: 'Para enviar, marque a autorização de contato.',
  rate_limited:
    'Recebemos vários pedidos deste aparelho ou contato na última hora. Tente de novo mais tarde ou fale pelo WhatsApp.',
  unavailable: 'Esta unidade não está mais disponível para contato por aqui. Recarregue a página.',
  unknown: 'Não foi possível enviar agora. Confira sua conexão e tente de novo.',
};

/** Só os dígitos; sem o 55 do Brasil quando vier com DDI. */
export function nationalDigits(value: string): string {
  let d = value.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.slice(0, 11);
}

/** Máscara brasileira progressiva: (16) 99769-4880 ou (16) 3333-4444. */
export function maskBrPhone(value: string): string {
  const d = nationalDigits(value);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  // Com 11 dígitos é celular (5 + 4); até 10, fixo (4 + 4).
  const split = d.length === 11 ? 5 : 4;
  if (rest.length <= split) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** DDD + 8 ou 9 dígitos, DDD sem zero (mesma regra do banco). */
export function isValidBrPhone(value: string): boolean {
  return /^[1-9][1-9]\d{8,9}$/.test(nationalDigits(value)) && value.replace(/\D/g, '').length <= 13;
}

export function isValidEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length <= EMAIL_MAX && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/** Nome sem espaços repetidos. */
export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Primeiro problema encontrado, na ordem dos campos do formulário. */
export function validateLead(
  input: Pick<LeadInput, 'name' | 'phone' | 'email' | 'message' | 'consent'>,
): { error: LeadErrorCode; field: LeadField } | null {
  const name = cleanName(input.name);
  if (name.length < 2 || name.length > NAME_MAX) return { error: 'invalid_name', field: 'name' };
  if (!isValidBrPhone(input.phone)) return { error: 'invalid_phone', field: 'phone' };
  if (input.email.trim() && !isValidEmail(input.email))
    return { error: 'invalid_email', field: 'email' };
  if (input.message.trim().length > MESSAGE_MAX)
    return { error: 'message_too_long', field: 'message' };
  if (!input.consent) return { error: 'consent_required', field: 'consent' };
  return null;
}

/** Campo do formulário ligado a cada erro (para marcar e focar). */
export const FIELD_OF_ERROR: Partial<Record<LeadErrorCode, LeadField>> = {
  invalid_name: 'name',
  invalid_phone: 'phone',
  invalid_email: 'email',
  message_too_long: 'message',
  consent_required: 'consent',
};

/** Erro do banco (código do create_lead) → erro do formulário. */
export function leadErrorFromDb(error: { code?: string; message?: string } | null): LeadErrorCode {
  if (!error) return 'unknown';
  if (error.code === 'VD429') return 'rate_limited';
  if (error.code === 'VD404') return 'unavailable';
  const known: LeadErrorCode[] = [
    'invalid_name',
    'invalid_phone',
    'invalid_email',
    'message_too_long',
    'consent_required',
  ];
  if (error.code === 'VD422') {
    if (error.message === 'contact_required') return 'invalid_phone';
    const m = known.find((k) => k === error.message);
    if (m) return m;
  }
  return 'unknown';
}

/**
 * Divide o texto de consentimento para transformar "Política de Privacidade" num link.
 * Sem o termo no texto, o link vai ao fim.
 */
export function splitConsentText(
  text: string,
  term = 'Política de Privacidade',
): { before: string; term: string; after: string } {
  const i = text.indexOf(term);
  if (i < 0) return { before: `${text} `, term, after: '' };
  return { before: text.slice(0, i), term, after: text.slice(i + term.length) };
}

/** Link canônico da unidade (sem outros parâmetros da página). */
export function unitLink(origin: string, slug: string, unitCode: string): string {
  return `${origin}/e/${encodeURIComponent(slug)}?u=${encodeURIComponent(unitCode)}`;
}

/** wa.me com mensagem pronta. `number` já vem com DDI (5516…). */
export function whatsappHref(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/**
 * Vendida ou indisponível: o pedido vira "opções parecidas", com a unidade como referência.
 * Reservada e em negociação seguem como interesse na própria unidade.
 */
export type InterestKind = 'unit' | 'similar';

type UnitStatusValue = 'available' | 'reserved' | 'negotiating' | 'sold' | 'unavailable';

export function interestKind(status: UnitStatusValue): InterestKind {
  return status === 'sold' || status === 'unavailable' ? 'similar' : 'unit';
}

const SIMILAR_STATUS_WORD: Partial<Record<UnitStatusValue, string>> = {
  sold: 'vendida',
  unavailable: 'indisponível',
};

/** Mensagem pré-preenchida no formulário de opções parecidas (o comprador pode editar). */
export function similarInterestMessage(unitCode: string, status: UnitStatusValue): string {
  const word = SIMILAR_STATUS_WORD[status];
  return `Interesse em unidade semelhante à ${unitCode}${word ? ` (${word})` : ''}`;
}

export function whatsappUnitMessage(
  unitCode: string,
  developmentName: string,
  link: string,
  status: UnitStatusValue = 'available',
) {
  if (status === 'sold')
    return `Olá! Vi que o ${unitCode} do ${developmentName} foi vendido, tem opções parecidas? ${link}`;
  if (status === 'unavailable')
    return `Olá! Vi que o ${unitCode} do ${developmentName} está indisponível, tem opções parecidas? ${link}`;
  return `Olá! Tenho interesse no apartamento ${unitCode} do ${developmentName}: ${link}`;
}
