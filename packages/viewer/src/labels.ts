/**
 * Posição das etiquetas dos cômodos na tela ("Ver apartamento"): sem sobreposição e sem
 * sair da tela. Módulo puro (testável sem WebGL).
 *
 * Guloso, por prioridade (maior área primeiro): cada etiqueta tenta ficar centrada no ponto
 * do cômodo; se colidir com uma já colocada, tenta deslocamentos curtos (acima, abaixo, aos
 * lados); se nenhum servir, fica oculta (o cômodo continua na lista ao lado). Etiquetas
 * perto da borda são empurradas para dentro.
 */

export interface LabelInput {
  id: string;
  /** Ponto do cômodo na tela (px, a partir do canto superior esquerdo). */
  x: number;
  y: number;
  /** Medidas da etiqueta (px). */
  w: number;
  h: number;
  /** Maior primeiro (ex.: área do cômodo). */
  priority: number;
  /** Ponto atrás da câmera ou fora do volume visível: não mostra. */
  hidden?: boolean;
}

export interface LabelPlacement {
  /** Canto superior esquerdo da etiqueta (px). */
  left: number;
  top: number;
  visible: boolean;
}

/** Folga mínima entre etiquetas (px). */
const GAP = 3;

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.l < b.r + GAP && b.l < a.r + GAP && a.t < b.b + GAP && b.t < a.b + GAP;

export function layoutLabels(
  items: LabelInput[],
  viewport: { width: number; height: number },
  pad = 8,
): Map<string, LabelPlacement> {
  const out = new Map<string, LabelPlacement>();
  const placed: Rect[] = [];
  const order = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const it of order) {
    if (it.hidden || it.w > viewport.width - 2 * pad || it.h > viewport.height - 2 * pad) {
      out.set(it.id, { left: 0, top: 0, visible: false });
      continue;
    }
    const dy = it.h + GAP;
    const dx = it.w / 2 + GAP;
    const candidates: [number, number][] = [
      [0, 0],
      [0, -dy],
      [0, dy],
      [dx, 0],
      [-dx, 0],
      [dx, -dy],
      [-dx, -dy],
      [dx, dy],
      [-dx, dy],
    ];
    let found: Rect | null = null;
    for (const [ox, oy] of candidates) {
      // Centrada no ponto (com o deslocamento), empurrada para dentro da tela.
      const l = Math.min(Math.max(it.x + ox - it.w / 2, pad), viewport.width - pad - it.w);
      const t = Math.min(Math.max(it.y + oy - it.h / 2, pad), viewport.height - pad - it.h);
      const r: Rect = { l, t, r: l + it.w, b: t + it.h };
      if (!placed.some((p) => overlaps(p, r))) {
        found = r;
        break;
      }
    }
    if (found) {
      placed.push(found);
      out.set(it.id, { left: found.l, top: found.t, visible: true });
    } else {
      out.set(it.id, { left: 0, top: 0, visible: false });
    }
  }
  return out;
}
