import { describe, expect, it } from 'vitest';
import {
  interestKind,
  isValidBrPhone,
  leadErrorFromDb,
  maskBrPhone,
  nationalDigits,
  similarInterestMessage,
  splitConsentText,
  unitLink,
  validateLead,
  whatsappHref,
  whatsappUnitMessage,
} from './lead-form';

describe('telefone brasileiro', () => {
  it.each([
    ['', ''],
    ['1', '(1'],
    ['16', '(16'],
    ['169', '(16) 9'],
    ['169976', '(16) 9976'],
    ['1699769', '(16) 9976-9'],
    ['1633334444', '(16) 3333-4444'],
    ['16997694880', '(16) 99769-4880'],
    ['(16) 99769-4880', '(16) 99769-4880'],
    ['+55 16 99769-4880', '(16) 99769-4880'],
    ['5516997694880', '(16) 99769-4880'],
    ['1699769488099', '(16) 99769-4880'], // excesso é cortado
  ])('máscara de %j → %j', (input, expected) => {
    expect(maskBrPhone(input)).toBe(expected);
  });

  it('dígitos nacionais tiram o 55 só quando vem com DDI', () => {
    expect(nationalDigits('+55 (16) 99769-4880')).toBe('16997694880');
    // DDD 55 (RS) com fixo de 8 dígitos: não é DDI.
    expect(nationalDigits('(55) 3333-4444')).toBe('5533334444');
  });

  it.each([
    ['(16) 99769-4880', true],
    ['(16) 3333-4444', true],
    ['+55 16 99769-4880', true],
    ['(55) 3333-4444', true],
    ['(01) 99999-9999', false],
    ['(16) 9976-488', false],
    ['', false],
  ])('%j válido? %s', (input, ok) => {
    expect(isValidBrPhone(input)).toBe(ok);
  });
});

describe('validação do formulário', () => {
  const ok = {
    name: 'Maria Souza',
    phone: '(16) 99769-4880',
    email: '',
    message: '',
    consent: true,
  };

  it('aceita o mínimo: nome, telefone e consentimento', () => {
    expect(validateLead(ok)).toBeNull();
  });

  it.each([
    [{ name: ' M ' }, 'name', 'invalid_name'],
    [{ name: 'x'.repeat(121) }, 'name', 'invalid_name'],
    [{ phone: '' }, 'phone', 'invalid_phone'],
    [{ phone: '(16) 9976' }, 'phone', 'invalid_phone'],
    [{ email: 'nao-e-email' }, 'email', 'invalid_email'],
    [{ message: 'x'.repeat(1001) }, 'message', 'message_too_long'],
    [{ consent: false }, 'consent', 'consent_required'],
  ])('%j → %s', (patch, field, error) => {
    expect(validateLead({ ...ok, ...patch })).toEqual({ field, error });
  });

  it('e-mail é opcional mas, se vier, precisa ser válido', () => {
    expect(validateLead({ ...ok, email: '  Maria@Exemplo.com ' })).toBeNull();
  });
});

describe('erros do banco', () => {
  it.each([
    [{ code: 'VD429', message: 'rate_limited' }, 'rate_limited'],
    [{ code: 'VD404', message: 'unit_not_found' }, 'unavailable'],
    [{ code: 'VD422', message: 'invalid_phone' }, 'invalid_phone'],
    [{ code: 'VD422', message: 'contact_required' }, 'invalid_phone'],
    [{ code: 'VD422', message: 'consent_required' }, 'consent_required'],
    [{ code: 'VD422', message: 'invalid_consent_version' }, 'unknown'],
    [{ code: '42501', message: 'invalid_ingest_key' }, 'unknown'],
    [null, 'unknown'],
  ])('%j → %s', (error, expected) => {
    expect(leadErrorFromDb(error)).toBe(expected);
  });
});

describe('consentimento e WhatsApp', () => {
  it('separa "Política de Privacidade" para virar link', () => {
    expect(splitConsentText('Autorizo, conforme a Política de Privacidade. Posso pedir.')).toEqual({
      before: 'Autorizo, conforme a ',
      term: 'Política de Privacidade',
      after: '. Posso pedir.',
    });
    expect(splitConsentText('Autorizo.')).toEqual({
      before: 'Autorizo. ',
      term: 'Política de Privacidade',
      after: '',
    });
  });

  it('monta wa.me com a mensagem pronta e o link canônico da unidade', () => {
    const link = unitLink('https://www.vidomo.com.br', 'residencial-vista', '802');
    expect(link).toBe('https://www.vidomo.com.br/e/residencial-vista?u=802');
    const text = whatsappUnitMessage('802', 'Residencial Vista', link);
    expect(text).toBe(
      'Olá! Tenho interesse no apartamento 802 do Residencial Vista: https://www.vidomo.com.br/e/residencial-vista?u=802',
    );
    const href = whatsappHref('5516997694880', text);
    expect(href.startsWith('https://wa.me/5516997694880?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1]!)).toBe(text);
  });
});

describe('vendida e indisponível: opções parecidas', () => {
  it.each([
    ['available', 'unit'],
    ['reserved', 'unit'],
    ['negotiating', 'unit'],
    ['sold', 'similar'],
    ['unavailable', 'similar'],
  ] as const)('%s → %s', (status, kind) => {
    expect(interestKind(status)).toBe(kind);
  });

  it('mensagem pré-preenchida com a unidade de referência', () => {
    expect(similarInterestMessage('802', 'sold')).toBe(
      'Interesse em unidade semelhante à 802 (vendida)',
    );
    expect(similarInterestMessage('802', 'unavailable')).toBe(
      'Interesse em unidade semelhante à 802 (indisponível)',
    );
  });

  it('WhatsApp: vendida e indisponível pedem opções parecidas; as outras, a própria unidade', () => {
    const link = 'https://www.vidomo.com.br/e/residencial-vista?u=802';
    expect(whatsappUnitMessage('802', 'Residencial Vista', link, 'sold')).toBe(
      `Olá! Vi que o 802 do Residencial Vista foi vendido, tem opções parecidas? ${link}`,
    );
    expect(whatsappUnitMessage('802', 'Residencial Vista', link, 'unavailable')).toBe(
      `Olá! Vi que o 802 do Residencial Vista está indisponível, tem opções parecidas? ${link}`,
    );
    for (const status of ['available', 'reserved', 'negotiating'] as const) {
      expect(whatsappUnitMessage('802', 'Residencial Vista', link, status)).toBe(
        `Olá! Tenho interesse no apartamento 802 do Residencial Vista: ${link}`,
      );
    }
  });
});
