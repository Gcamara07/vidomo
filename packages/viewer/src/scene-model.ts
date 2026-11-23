/**
 * Lê a cena carregada do GLB e separa unidades, andares e estrutura pela convenção de
 * nomes. O viewer renderiza essas partes declarativamente (com materiais próprios),
 * então as cores/texturas que vieram no GLB são ignoradas.
 */
import type { Material, Matrix4 } from 'three';
import {
  Box3,
  BufferAttribute,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from 'three';
import {
  DEFAULT_OBJECT_KEY_PREFIXES,
  parseObjectName,
  type ObjectKeyPrefixes,
  type ObjectKind,
} from './naming';

export interface ScenePart {
  /** Nome do objeto no GLB (ex.: UNIT__TA__F08__U802). */
  name: string;
  kind: ObjectKind | null;
  /** object_key (sem prefixo) quando o nome segue a convenção; senão null. */
  objectKey: string | null;
  geometry: BufferGeometry;
  /** Transformação mundial do objeto na cena original. */
  matrix: Matrix4;
  /** Material original do GLB (cor exportada). Unidades e estrutura o ignoram; a camada de
   *  detalhes usa a cor dele em versão chapada. */
  sourceMaterial: Material | null;
}

export interface BuildingModel {
  units: ScenePart[];
  floors: ScenePart[];
  /** Vidros da fachada por unidade (VIDRO__<object_key>): pintados pelo status dela. */
  glass: ScenePart[];
  /** Torre, áreas comuns, visuais e objetos sem prefixo. */
  structure: ScenePart[];
  /** Caixa de tudo. */
  bounds: Box3;
  /** Caixa do prédio (unidades, andares, torre) — usada para enquadrar a câmera. */
  focusBounds: Box3;
}

/** Sobe a hierarquia até achar um nome com prefixo conhecido (malha multi-primitiva vira grupo). */
function namedAncestor(obj: Object3D, prefixes: ObjectKeyPrefixes): Object3D {
  let firstPrefixed: Object3D | null = null;
  for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
    const parsed = parseObjectName(cur.name, prefixes);
    if (parsed?.valid) return cur;
    if (parsed && !firstPrefixed) firstPrefixed = cur;
  }
  return firstPrefixed ?? obj;
}

/**
 * UVs em metros por projeção na face dominante, usando a escala mundial do objeto.
 * Assim a hachura tem o mesmo espaçamento em qualquer unidade, independente das UVs
 * (ou da falta delas) no arquivo e da quantização do Meshopt.
 */
export function withMetricUVs(geometry: BufferGeometry, scale: Vector3): BufferGeometry {
  const g = geometry.clone();
  const pos = g.getAttribute('position');
  if (!pos) return g;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nor = g.getAttribute('normal')!;
  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * scale.x;
    const y = pos.getY(i) * scale.y;
    const z = pos.getZ(i) * scale.z;
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = z;
      v = y;
    } else if (ay >= az) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

export function extractBuilding(
  root: Object3D,
  prefixes: Partial<ObjectKeyPrefixes> = {},
): BuildingModel {
  const px: ObjectKeyPrefixes = { ...DEFAULT_OBJECT_KEY_PREFIXES, ...prefixes };
  root.updateMatrixWorld(true);

  const model: BuildingModel = {
    units: [],
    floors: [],
    glass: [],
    structure: [],
    bounds: new Box3(),
    focusBounds: new Box3(),
  };
  const uvCache = new Map<string, BufferGeometry>();
  const tmpPos = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const box = new Box3();

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;

    const owner = namedAncestor(mesh, px);
    const parsed = parseObjectName(owner.name, px);
    const matrix = mesh.matrixWorld.clone();
    let geometry = mesh.geometry;

    const isUnit = parsed?.kind === 'unit' && parsed.valid;
    const isGlass = parsed?.kind === 'glass' && parsed.valid;
    // UVs em metros também nos vidros (hachura de reservado e em negociação).
    if (isUnit || isGlass) {
      matrix.decompose(tmpPos, tmpQuat, tmpScale);
      const key = `${geometry.uuid}|${tmpScale.toArray().map((n) => n.toFixed(5))}`;
      let g = uvCache.get(key);
      if (!g) {
        g = withMetricUVs(geometry, tmpScale);
        uvCache.set(key, g);
      }
      geometry = g;
    }

    const part: ScenePart = {
      name: owner.name,
      kind: parsed?.kind ?? null,
      objectKey: parsed?.valid ? parsed.objectKey : null,
      geometry,
      matrix,
      sourceMaterial: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) ?? null,
    };

    if (isUnit) model.units.push(part);
    else if (isGlass) model.glass.push(part);
    else if (parsed?.kind === 'floor') model.floors.push(part);
    else model.structure.push(part);

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    box.copy(geometry.boundingBox!).applyMatrix4(matrix);
    model.bounds.union(box);
    if (isUnit || parsed?.kind === 'floor' || parsed?.kind === 'tower')
      model.focusBounds.union(box);
  });

  // Sem objetos do prédio (ex.: modelo de detalhes), enquadra tudo.
  if (model.focusBounds.isEmpty()) model.focusBounds.copy(model.bounds);
  return model;
}
