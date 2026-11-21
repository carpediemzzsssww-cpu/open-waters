import type { Progress, WorldContext } from '../world/build';
import { buildFjord, updateFjord } from './fjord';

export async function build(ctx: WorldContext, step: Progress) {
  await step('峡湾、瀑布与木屋', 0.15);
  buildFjord(ctx.scene);
  return [{ update: updateFjord }];
}
