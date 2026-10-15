import { describe, expect, it } from 'vitest';
import { orderByProximity } from './maps';

describe('orderByProximity', () => {
  it('va siempre a la parada más cercana', () => {
    const s = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude });
    // Desde San Salvador: Soyapango, luego Santa Tecla, luego Usulután
    const out = orderByProximity([s('ss', 13.699, -89.191), s('usu', 13.35, -88.45), s('tecla', 13.677, -89.28), s('soya', 13.71, -89.14)]);
    expect(out.map((x) => x.id)).toEqual(['ss', 'soya', 'tecla', 'usu']);
  });
});
