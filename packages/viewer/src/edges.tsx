/** Contorno em lote: as mesmas linhas do <Edges> do drei (largura em px de tela), num draw call. */
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color, type Plane } from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib';

const noRaycast = () => null;

export function BatchEdges({
  positions,
  color,
  clip,
  width = 1,
  opacity = 1,
  renderOrder = 0,
}: {
  positions: Float32Array;
  color: string;
  clip: Plane[] | null;
  width?: number;
  opacity?: number;
  renderOrder?: number;
}) {
  const w = useThree((s) => s.size.width);
  const h = useThree((s) => s.size.height);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial();
    material.color = new Color(color);
    material.linewidth = width;
    if (opacity < 1) {
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
    }
    if (clip) material.clippingPlanes = clip;
    const l = new LineSegments2(geometry, material);
    l.computeLineDistances();
    l.renderOrder = renderOrder;
    l.raycast = noRaycast as unknown as LineSegments2['raycast'];
    return l;
  }, [positions, color, clip, width, opacity, renderOrder]);
  useLayoutEffect(() => {
    line.material.resolution.set(w, h);
  }, [line, w, h]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}
