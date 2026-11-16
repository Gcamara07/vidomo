/**
 * Receptor LOCAL de teste do webhook de leads (faz o papel do n8n).
 *
 *   VIDOMO_WEBHOOK_SECRET=whsec_… pnpm webhook:receive [--port 8787] [--fail 500]
 *
 * - Responde 200 quando X-Vidomo-Signature confere e 401 quando não (como o n8n).
 * - --fail <status> responde sempre esse status (para ver o reenvio funcionando).
 * - Mostra evento, entrega e o JSON recebido. Só para desenvolvimento: imprime dados do lead.
 *
 * No /painel/config local, use a URL http://host.docker.internal:8787/vidomo — a Edge
 * Function roda no Docker e enxerga a sua máquina por esse nome.
 */
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { verifyVidomoSignature } from './lib/webhook-signature';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    fail: { type: 'string' },
  },
});

const secret = process.env.VIDOMO_WEBHOOK_SECRET ?? '';
if (!/^whsec_[0-9a-f]{64}$/.test(secret)) {
  console.error('Defina VIDOMO_WEBHOOK_SECRET com o segredo gerado no /painel/config (whsec_…).');
  process.exit(1);
}
const failWith = values.fail ? Number(values.fail) : null;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const time = new Date().toLocaleTimeString('pt-BR');
    const event = req.headers['x-vidomo-event'];
    const delivery = req.headers['x-vidomo-delivery'];
    const signature = req.headers['x-vidomo-signature'];
    const valid = verifyVidomoSignature(
      raw,
      Array.isArray(signature) ? signature[0] : signature,
      secret,
    );
    const status = failWith ?? (valid ? 200 : 401);

    console.log(
      `\n[${time}] ${req.method} ${req.url} evento=${event} entrega=${delivery} ` +
        `assinatura=${valid ? 'ok' : 'INVÁLIDA'} → ${status}`,
    );
    try {
      console.log(JSON.stringify(JSON.parse(raw.toString('utf8')), null, 2));
    } catch {
      console.log(raw.toString('utf8'));
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 200 }));
  });
});

server.listen(Number(values.port), () => {
  console.log(
    `Receptor de teste em http://localhost:${values.port} ` +
      `(no painel local: http://host.docker.internal:${values.port}/vidomo)` +
      (failWith ? ` — respondendo sempre ${failWith}` : ''),
  );
});
