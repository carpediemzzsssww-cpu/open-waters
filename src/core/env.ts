// Resolve this once. Geometry detail stays fixed while the renderer adapts its pixel budget.
const quality = new URLSearchParams(location.search).get('q');
export const MINI = import.meta.env.MODE === 'minitool';
export const LIGHT_GEOMETRY = MINI || quality === 'low' || (!quality && matchMedia('(pointer: coarse)').matches);

export function seg(n: number, minimum = 4) {
  return LIGHT_GEOMETRY ? Math.max(minimum, Math.round(n * 0.55)) : n;
}
