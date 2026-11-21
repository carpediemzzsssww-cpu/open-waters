import * as quays from '../world/quays';
import * as alexandre from '../world/alexandre';
import * as bridges from '../world/bridges';
import * as city from '../world/city';
import * as landmarks from '../world/landmarks';
import * as trees from '../world/trees';
import * as traffic from '../world/traffic';
import * as people from '../world/people';
import * as lamps from '../world/lamps';
import * as birds from '../world/birds';
import { buildStages, type Progress, type WorldContext } from '../world/build';

export function build(ctx: WorldContext, step: Progress) {
  return buildStages(ctx, step, [
    ['quays', quays.build], ['bridge', alexandre.build], ['bridges', bridges.build],
    ['city', city.build], ['landmarks', landmarks.build], ['trees', trees.build],
    ['traffic', traffic.build], ['people', people.build], ['lamps', lamps.build], ['birds', birds.build],
  ]);
}
