import type { Progress, WorldContext } from '../world/build';
import { buildSeto, ferryTraffic, updateSeto } from './seto';

export async function build(ctx: WorldContext, step: Progress) {
  await step('岛屿、渔港与跨海桥', 0.15);
  buildSeto(ctx.scene);
  return [{ update: updateSeto, boats: [ferryTraffic] }];
}
