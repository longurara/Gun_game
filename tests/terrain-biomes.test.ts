import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrainWeights} from '../src/terrain-biomes.ts';
import type {TerrainSample} from '../src/terrain-biomes.ts';

const meadow: TerrainSample = {height:40, seaLevel:0, slope:0.1, noise:0.5, forest:0.4, town:0, lakeSand:0, riverWet:0};
test('terrain surfaces distinguish meadow, forest floor, beaches and steep bedrock', () => {
  assert.ok(terrainWeights(meadow)[0] > 0.95);
  assert.ok(terrainWeights({...meadow, forest:0.9, noise:0.9})[1] > 0.8);
  assert.ok(terrainWeights({...meadow, height:1.2})[2] > 0.9);
  assert.ok(terrainWeights({...meadow, slope:0.9})[3] > 0.95);
});
test('lake shores and wet riverbanks override inland terrain, including steep faces', () => {
  assert.ok(terrainWeights({...meadow, slope:0.8, lakeSand:0.75})[2] > 0.7);
  assert.ok(terrainWeights({...meadow, slope:0.8, riverWet:0.85})[1] > 0.8);
  assert.ok(terrainWeights({...meadow, town:1})[1] > 0.8);
});
test('crops use meadow texture while tilled and dry fields use earth', () => {
  assert.ok(terrainWeights({...meadow, slope:0.8, field:1})[0] > 0.9);
  for (const field of [0,2] as const) assert.ok(terrainWeights({...meadow, slope:0.8, field})[1] > 0.9);
});
test('coast masks follow the water level rather than absolute map height', () => {
  const coast=terrainWeights({...meadow,height:1.8});
  const shifted=terrainWeights({...meadow,height:31.8,seaLevel:30});
  assert.ok(shifted.every((value, i) => Math.abs(value - coast[i]) < 1e-10));
  assert.ok(terrainWeights({...meadow,height:1.8,seaLevel:-60})[2] < 0.01, 'valley floor is not a sea beach');
});
test('blends remain normalized and transition continuously across height and slope thresholds', () => {
  for (let i=0;i<2000;i++) {
    const current=terrainWeights({...meadow,height:-2+i*0.075,slope:i/1300,noise:(i%97)/96,forest:(i%89)/88,town:(i%13)/12,lakeSand:(i%17)/20,riverWet:(i%19)/22});
    assert.ok(current.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(Math.abs(current.reduce((a,b)=>a+b,0)-1)<1e-10);
  }
  for (const height of [1.4,3.8,100,140]) {
    const a=terrainWeights({...meadow,height:height-0.0001}),b=terrainWeights({...meadow,height:height+0.0001});
    assert.ok(a.every((v,i)=>Math.abs(v-b[i])<0.001));
  }
  for (const slope of [0.34,0.6]) {
    const a=terrainWeights({...meadow,slope:slope-0.0001}),b=terrainWeights({...meadow,slope:slope+0.0001});
    assert.ok(a.every((v,i)=>Math.abs(v-b[i])<0.001));
  }
});
