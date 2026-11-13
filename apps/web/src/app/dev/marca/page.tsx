import type { Metadata } from 'next';

// Rota interna: fora do caminho de quem visita e fora dos buscadores.
export const metadata: Metadata = {
  title: 'Marca · Vidomo (interno)',
  robots: { index: false, follow: false },
};

const swatches = [
  ['Musgo', '--color-musgo'],
  ['Sálvia', '--color-salvia'],
  ['Latão', '--color-latao'],
  ['Latão Profundo', '--color-latao-profundo'],
  ['Latão Claro', '--color-latao-claro'],
  ['Papel', '--color-papel'],
  ['Linho', '--color-linho'],
  ['Areia', '--color-areia'],
  ['Cinza quente', '--color-cinza-quente'],
  ['Nanquim', '--color-nanquim'],
  ['Erro', '--color-erro'],
] as const;

// Referência interna dos tokens de cor e das fontes da marca.
export default function BrandPage() {
  return (
    <main style={{ padding: '32px 16px', maxWidth: 880, margin: '0 auto' }}>
      <h1>
        Vidomo — <em>eu vejo a casa</em>
      </h1>
      <p>Inter para texto e interface.</p>
      <p className="mono">UNIT__TA__F08__U802 · 68,4 m²</p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        }}
      >
        {swatches.map(([name, token]) => (
          <li key={token}>
            <div
              style={{
                height: 56,
                background: `var(${token})`,
                border: '1px solid var(--color-musgo)',
              }}
            />
            <div style={{ fontSize: 14 }}>{name}</div>
            <code style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{token}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
