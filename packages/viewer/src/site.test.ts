import { describe, expect, it } from 'vitest';
import { classifyZone, towerFootprint, type Box } from './site';

const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });

// Caixas reais do Residencial Vista (modelo leve + detalhes), em metros.
const fp = towerFootprint([
  box([-9.5, 0, -8.5], [9.5, 4, 8.5]), // TOWER__TA
  box([-9.5, 4, -8.5], [9.5, 4.2, 8.5]), // FLOOR__TA__F01
  box([-9.5, 31, -8.5], [9.5, 31.2, 8.5]), // FLOOR__TA__F10
]);

describe('towerFootprint', () => {
  it('envolve TOWER__ e FLOOR__ em planta', () => {
    expect(fp).toEqual({ minX: -9.5, maxX: 9.5, minZ: -8.5, maxZ: 8.5 });
    expect(towerFootprint([])).toBeNull();
  });
});

describe('classifyZone (margem de 2 m)', () => {
  it.each([
    ['VIS__VARANDAS', box([-8.7, 4, -10.1], [8.7, 31.15, 10.1]), 'tower'],
    ['VIS__GUARDACORPO', box([-8.75, 4.15, -10.15], [8.75, 32.15, 10.15]), 'tower'],
    ['VIS__ESQUADRIAS', box([-9.58, 4.2, -8.58], [9.58, 34, 8.58]), 'tower'],
    ['VIS__FECHAMENTO_HALL', box([-9.5, 4.2, -1.5], [9.5, 34, 1.5]), 'tower'],
    ['VIS__PLATIBANDA', box([-9.5, 34.2, -8.5], [9.5, 37.2, 8.5]), 'tower'],
    ['VIS__NUCLEO', box([-0.6, 4, -1.4], [3.4, 37, 1.4]), 'tower'],
    ['VIS__PORTARIA_MARQUISE', box([-5, 0, -12.5], [5, 3.6, -8.5]), 'site'],
    ['AMENITY__ACADEMIA', box([-18.5, 0, -3], [-12.5, 3.2, 6]), 'site'],
    ['AMENITY__PISCINA', box([-12, -0.02, 14.5], [3, 0.06, 20.5]), 'site'],
    ['AMENITY__GOURMET', box([7.6, 0, 14.6], [17.4, 3.25, 23.4]), 'site'],
    ['VIS__ARVORES', box([-20.61, 2.11, -19.56], [21.02, 7.61, 26.41]), 'site'],
    ['VIS__TERRENO', box([-20, -0.1, -20], [20, 0, 26]), 'site'],
    ['VIS__RUA', box([-30, -0.12, -31], [30, 0.12, -20]), 'site'],
  ])('%s → %s', (_name, b, zone) => {
    expect(classifyZone(b, fp)).toBe(zone);
  });

  it('sem projeção da torre, tudo é torre (comportamento anterior)', () => {
    expect(classifyZone(box([-50, 0, -50], [50, 1, 50]), null)).toBe('tower');
  });
});
