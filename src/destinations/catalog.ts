import type { Part, Progress, WorldContext } from '../world/build';

interface Landmark {
  name: string;
  subtitle: string;
  minZ: number;
  maxZ: number;
}

export interface Voyage {
  id: string;
  name: string;
  localName: string;
  region: string;
  description: string;
  navigation: { spawnX: number; spawnZ: number; halfWidth: number; minZ: number; maxZ: number };
  landmarks?: Landmark[];
  citySounds?: boolean;
  bridgeShade?: { z: number; halfSpan: number };
  waterTint?: [number, number, number];
  sunBearing?: number;
  daylight?: { skyTint: [number, number, number]; haze: number; glow: number };
  loadWorld: () => Promise<{ build: (ctx: WorldContext, step: Progress) => Promise<Part[]> }>;
}

export const voyages: Voyage[] = [
  {
    id: 'seine',
    name: '塞纳河',
    localName: 'La Seine',
    region: '法国 · 巴黎',
    description: '沿石砌河岸向西，穿过亚历山大三世桥的拱影。',
    navigation: { spawnX: 8, spawnZ: 262, halfWidth: 54, minZ: -590, maxZ: 520 },
    citySounds: true,
    bridgeShade: { z: 0, halfSpan: 21 },
    landmarks: [
      { minZ: 30, maxZ: 150, name: 'Pont Alexandre III', subtitle: '亚历山大三世桥' },
      { minZ: -130, maxZ: -40, name: 'La tour Eiffel', subtitle: '埃菲尔铁塔' },
      { minZ: -215, maxZ: -135, name: 'Pont des Invalides', subtitle: '荣军院桥' },
    ],
    loadWorld: () => import('./seine-route'),
  },
  {
    id: 'fjord',
    name: '盖朗厄尔峡湾',
    localName: 'Geirangerfjord',
    region: '挪威 · 西部峡湾',
    description: '把船开进两壁山影之间，沿着岩面寻找落进峡湾的瀑布。',
    navigation: { spawnX: 0, spawnZ: 155, halfWidth: 160, minZ: -950, maxZ: 280 },
    landmarks: [{ minZ: -218, maxZ: -130, name: 'Fossen', subtitle: '左舷 · 岩壁上的瀑布' }],
    waterTint: [0.64, 1.6, 2.1],
    sunBearing: 62,
    daylight: { skyTint: [0.58, 0.94, 1.48], haze: 0.77, glow: 0.57 },
    loadWorld: () => import('./fjord-route'),
  },
  {
    id: 'seto',
    name: '濑户内海',
    localName: 'Seto Inland Sea',
    region: '日本 · 濑户内',
    description: '驶离港边的屋舍，迎着层层岛影慢慢转舵。',
    navigation: { spawnX: 0, spawnZ: 155, halfWidth: 320, minZ: -950, maxZ: 280 },
    landmarks: [{ minZ: -430, maxZ: -320, name: 'Seto Inland Sea', subtitle: '前方 · 跨岛悬索桥' }],
    waterTint: [0.74, 1.45, 2.05],
    sunBearing: -14,
    daylight: { skyTint: [0.88, 1.03, 1.22], haze: 1.04, glow: 0.88 },
    loadWorld: () => import('./seto-route'),
  },
];

const requested = new URLSearchParams(window.location.search).get('voyage');
export const activeVoyage = voyages.find(v => v.id === requested) ?? voyages[0];
