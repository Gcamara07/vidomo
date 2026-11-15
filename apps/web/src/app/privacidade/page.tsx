import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './privacidade.module.css';

export const metadata: Metadata = {
  title: 'Política de Privacidade · Vidomo',
  description: 'Como os dados enviados pelo formulário de interesse são usados.',
};

/**
 * Política padrão da demonstração (usada quando a incorporadora não configurou a própria
 * em organization_settings.privacy_policy_url). Texto de demonstração: antes de uso real,
 * cada incorporadora deve publicar a sua, revisada pelo jurídico.
 */
export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Vidomo · versão de demonstração · novembro de 2026</p>
      <h1>Política de Privacidade</h1>

      <p className={styles.lead}>
        Quando você envia o formulário <em>Tenho interesse</em> na página de um empreendimento, seus
        dados vão para a incorporadora responsável por ele, para que a equipe comercial fale com
        você.
      </p>

      <h2>Quem trata os dados</h2>
      <p>
        A incorporadora do empreendimento é a <strong>controladora</strong>: decide como os dados
        são usados. A Vidomo é a plataforma que hospeda a página e entrega o contato à equipe da
        incorporadora, e atua como <strong>operadora</strong>, seguindo as instruções dela.
      </p>

      <h2>Quais dados</h2>
      <ul>
        <li>Nome, telefone e, se você informar, e-mail e mensagem.</li>
        <li>A unidade de interesse e a data do envio.</li>
        <li>A versão do texto de autorização que você aceitou e quando aceitou.</li>
      </ul>
      <p>
        Não guardamos seu endereço IP junto com o pedido. Para evitar envios automáticos em massa,
        usamos por até 24 horas apenas uma forma embaralhada do IP e do contato, que não permite
        identificá-lo.
      </p>

      <h2>Para que</h2>
      <p>
        Só para a equipe comercial entrar em contato sobre o empreendimento. Os dados podem ser
        encaminhados ao sistema de atendimento da incorporadora (por exemplo, um CRM) para o mesmo
        fim.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Enquanto houver atendimento ou até você pedir a exclusão, respeitados os prazos que a lei
        exigir.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Pela Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode pedir acesso, correção ou
        exclusão dos seus dados e revogar a autorização a qualquer momento. Basta pedir à
        incorporadora pelos canais de atendimento do empreendimento (WhatsApp ou e-mail). A exclusão
        é feita pela equipe e fica registrada, sem os seus dados.
      </p>

      <p className={styles.back}>
        <Link href="/">Voltar ao empreendimento</Link>
      </p>
    </main>
  );
}
