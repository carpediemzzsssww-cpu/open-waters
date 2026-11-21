import { activeVoyage } from '../destinations/catalog';
import { clockLabel, SEASONS, seasonState } from '../core/seasons';
import S from './strings.json';

/** 3:4 竖版明信片：画面铺满，左下角一行地名和时间 */
export function composeCard(frame: HTMLCanvasElement, z: number, dusk: number) {
  const W = 1080, H = 1440;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const s = Math.max(W / frame.width, H / frame.height);
  const dw = frame.width * s, dh = frame.height * s;
  g.drawImage(frame, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const grd = g.createLinearGradient(0, H * 0.7, 0, H);
  grd.addColorStop(0, 'rgba(20,12,16,0)');
  grd.addColorStop(1, 'rgba(20,12,16,0.42)');
  g.fillStyle = grd;
  g.fillRect(0, H * 0.7, W, H * 0.3);
  const seine = activeVoyage.id === 'seine';
  const landmark = activeVoyage.landmarks?.find(p => z >= p.minZ && z <= p.maxZ);
  const place = seine
    ? Math.abs(z) < 150 ? S.places.alexandre : z < -380 ? S.places.concorde : z < -150 ? S.places.invalides : S.places.start
    : landmark?.name || activeVoyage.region;
  const clock = clockLabel(dusk);
  g.shadowColor = 'rgba(30,10,10,0.55)';
  g.shadowBlur = 18;
  g.fillStyle = 'rgba(255,246,232,0.96)';
  g.textBaseline = 'alphabetic';
  g.font = 'italic 400 76px Didot, "Bodoni 72", "Playfair Display", Georgia, "Times New Roman", serif';
  g.fillText(activeVoyage.localName, 72, H - 140, W - 144);
  g.font = '400 30px Didot, "Bodoni 72", Georgia, "Times New Roman", serif';
  g.fillStyle = 'rgba(255,240,220,0.82)';
  const line = `${place}  ·  ${clock}  ·  ${seine ? SEASONS[seasonState.current].fr : SEASONS[seasonState.current].name}`;
  let x = 76;
  for (const ch of line) {
    g.fillText(ch, x, H - 84);
    x += g.measureText(ch).width + 3;
  }
  return c;
}
