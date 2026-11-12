/**
 * Caixa (paralelepípedo) com normais planas e UVs em metros por face.
 * UV em metros mantém a hachura do viewer com o mesmo espaçamento em todas as faces,
 * independente do tamanho da face.
 */
export interface BoxArrays {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  indices: Uint16Array<ArrayBuffer>;
}

export function boxArrays(width: number, height: number, depth: number): BoxArrays {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;

  // Cada face: normal, eixo u, eixo v (unitários) e meia-dimensões ao longo de u/v.
  const faces: Array<{
    n: [number, number, number];
    u: [number, number, number];
    v: [number, number, number];
    hu: number;
    hv: number;
    d: number;
  }> = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], hu: hz, hv: hy, d: hx },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], hu: hz, hv: hy, d: hx },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], hu: hx, hv: hz, d: hy },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], hu: hx, hv: hz, d: hy },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], hu: hx, hv: hy, d: hz },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], hu: hx, hv: hy, d: hz },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const f of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      for (let i = 0; i < 3; i++) {
        positions.push(f.n[i]! * f.d + f.u[i]! * su * f.hu + f.v[i]! * sv * f.hv);
        normals.push(f.n[i]!);
      }
      uvs.push(((su + 1) / 2) * f.hu * 2, ((1 - sv) / 2) * f.hv * 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}
