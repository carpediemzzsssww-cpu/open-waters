import * as THREE from 'three';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
// 代表性晚间钟点，用于氛围演绎，并非按日期计算的天文日落表。
export const SEASONS = {
  spring: { label: '春', name: '春日', fr: 'Printemps', start: 19 * 60 + 25, fog: 1.08, tint: [0.96, 1.03, 1.06], leaf: [1.05, 1.28, 0.86], density: 0.86, sun: 0.95 },
  summer: { label: '夏', name: '夏日', fr: 'Été', start: 21 * 60 + 5, fog: 1, tint: [1, 1, 1], leaf: [1, 1, 1], density: 1, sun: 1 },
  autumn: { label: '秋', name: '秋日', fr: 'Automne', start: 17 * 60 + 35, fog: 1.18, tint: [1.04, 0.94, 0.91], leaf: [3.15, 1.05, 0.24], density: 0.65, sun: 0.91 },
  winter: { label: '冬', name: '冬日', fr: 'Hiver', start: 16 * 60 + 10, fog: 1.3, tint: [0.85, 0.96, 1.15], leaf: [0.9, 0.82, 0.68], density: 0, sun: 0.82 },
} as const;
export const seasonState: { current: Season; revision: number } = { current: 'summer', revision: 0 };
export const foliage = {
  uLeafTint: { value: new THREE.Vector3(1, 1, 1) },
  uLeafDensity: { value: 1 },
};
export const seasonTint = new THREE.Color(1, 1, 1);
export function selectSeason(value: string) {
  if (!Object.prototype.hasOwnProperty.call(SEASONS, value)) return;
  seasonState.current = value as Season;
  seasonState.revision++;
  const s = SEASONS[seasonState.current];
  foliage.uLeafTint.value.fromArray(s.leaf);
  foliage.uLeafDensity.value = s.density;
  seasonTint.setRGB(s.tint[0], s.tint[1], s.tint[2]);
}
export function clockMinutes(dusk: number) { return Math.round(SEASONS[seasonState.current].start + dusk * 105); }
export function clockLabel(dusk: number) {
  const m = clockMinutes(dusk);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
