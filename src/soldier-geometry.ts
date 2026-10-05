import { Bag, Shaper } from './geometry';
import type { RGB } from './geometry';

/**
 * Pure geometry for the soldier, one `Bag` per body part. Parts are authored in the local space of the joint that
 * moves them (limbs hang along -Y from their pivot). Fabric is white so an instance colour can tint one mesh into any
 * uniform; gear and details are baked in darker vertex colours.
 */
export const ARM_UPPER = 0.34;
export const ARM_FORE = 0.32;
export const HIP_HEIGHT = 0.95;
export const KNEE_DROP = 0.44;
export const SHOULDER: [number, number, number] = [0.27, 1.42, 0];
export const HAND_REACH = 0.06;

export type PartName =
  | 'torso0' | 'torso1' | 'torso2' | 'head' | 'hair' | 'cap' | 'beanie' | 'helmet' | 'vest'
  | 'thigh' | 'shin' | 'upper' | 'fore';
export const FABRIC_PARTS: readonly PartName[] = ['torso0', 'torso1', 'torso2', 'thigh', 'shin', 'upper', 'fore'];

const WHITE: RGB = [1, 1, 1];
const grey = (v: number): RGB => [v, v, v];

export function buildSoldierPart(name: PartName, fabric: 'camoMono' | 'weave'): Bag {
  const bag = new Bag();
  // Cloth repeats coarsely (camouflage blotches should be hand-sized); moulded plastic gets a fine grain.
  const s = new Shaper(bag, name === 'helmet' || name === 'vest' ? 7 : 2.4);
  const cloth = () => s.use(fabric, WHITE);
  const gear = (c: RGB) => s.use(fabric, [Math.min(1, c[0] * 1.7), Math.min(1, c[1] * 1.7), Math.min(1, c[2] * 1.7)]);
  switch (name) {
    case 'torso0': case 'torso1': case 'torso2': {
      cloth().box(0.36, 0.2, 0.24, { at: [0, 0.9, 0] });
      cloth().box(0.37, 0.2, 0.245, { at: [0, 1.06, 0] });
      cloth().box(0.45, 0.32, 0.27, { at: [0, 1.27, 0] });
      cloth().box(0.4, 0.1, 0.25, { at: [0, 1.46, 0] });
      for (const side of [-1, 1]) cloth().sphere([0.17, 0.17, 0.17], { at: [side * 0.265, 1.4, 0] }, 5);
      // Belt, buckle, pouches and holster.
      gear(grey(0.2)).box(0.4, 0.07, 0.265, { at: [0, 0.96, 0] });
      gear([0.75, 0.72, 0.55]).box(0.06, 0.05, 0.02, { at: [0, 0.96, 0.138] });
      for (const x of [-0.12, 0.12]) gear([0.3, 0.32, 0.25]).box(0.08, 0.1, 0.055, { at: [x, 0.99, 0.15] });
      gear(grey(0.16)).box(0.07, 0.17, 0.11, { at: [-0.215, 0.86, 0.02] });
      gear(grey(0.22)).box(0.065, 0.1, 0.09, { at: [0.215, 0.9, -0.05] });
      // Backpack, three kinds.
      if (name === 'torso0') {
        gear([0.38, 0.4, 0.32]).box(0.32, 0.4, 0.17, { at: [0, 1.28, -0.215] });
        for (const x of [-0.19, 0.19]) gear([0.32, 0.34, 0.27]).box(0.07, 0.2, 0.12, { at: [x, 1.2, -0.22] });
        gear(grey(0.2)).box(0.3, 0.03, 0.18, { at: [0, 1.48, -0.215] });
      } else if (name === 'torso1') {
        gear([0.34, 0.35, 0.27]).box(0.38, 0.55, 0.24, { at: [0, 1.24, -0.25] });
        gear([0.45, 0.4, 0.28]).cyl(0.075, 0.075, 0.4, 'x', { at: [0, 1.6, -0.26] }, 8);
        for (const x of [-0.23, 0.23]) gear([0.3, 0.32, 0.25]).box(0.09, 0.22, 0.15, { at: [x, 1.12, -0.25] });
        gear(grey(0.18)).box(0.36, 0.04, 0.245, { at: [0, 1.4, -0.25] });
      } else {
        gear([0.28, 0.3, 0.26]).box(0.3, 0.34, 0.16, { at: [0, 1.28, -0.2] });
        gear(grey(0.15)).cyl(0.009, 0.006, 0.55, 'y', { at: [0.12, 1.7, -0.22] }, 5);
        gear(grey(0.12)).box(0.22, 0.12, 0.05, { at: [0, 1.32, -0.295] });
        gear([0.5, 0.45, 0.2]).box(0.05, 0.05, 0.05, { at: [-0.07, 1.32, -0.322] });
      }
      break;
    }
    case 'head': {
      // Skin: tinted per soldier by the instance colour.
      s.use('skin', WHITE);
      s.sphere([0.205, 0.235, 0.22], { at: [0, 1.665, 0] }, 7);
      s.box(0.15, 0.08, 0.16, { at: [0, 1.58, 0.012] });
      s.cyl(0.055, 0.06, 0.12, 'y', { at: [0, 1.5, 0] }, 8);
      s.use('skin', [0.94, 0.8, 0.76]);
      s.box(0.032, 0.04, 0.045, { at: [0, 1.65, 0.118] });
      for (const side of [-1, 1]) s.use('skin', [0.93, 0.82, 0.78]).sphere([0.035, 0.06, 0.03], { at: [side * 0.105, 1.655, 0] }, 4);
      for (const side of [-1, 1]) {
        s.use('skin', [0.96, 0.96, 0.96]).box(0.045, 0.024, 0.01, { at: [side * 0.047, 1.676, 0.106] });
        s.use('skin', [0.08, 0.08, 0.1]).box(0.02, 0.02, 0.01, { at: [side * 0.047, 1.676, 0.112] });
        s.use('skin', [0.3, 0.22, 0.18]).box(0.052, 0.01, 0.012, { at: [side * 0.047, 1.703, 0.106], rot: [0, 0, side * -0.12] });
      }
      s.use('skin', [0.55, 0.3, 0.3]).box(0.056, 0.008, 0.01, { at: [0, 1.604, 0.11] });
      break;
    }
    case 'hair':
      s.use('plain', WHITE);
      s.sphere([0.226, 0.205, 0.245], { at: [0, 1.685, -0.012] }, 6);
      s.box(0.2, 0.03, 0.05, { at: [0, 1.738, 0.098] });
      s.box(0.2, 0.08, 0.04, { at: [0, 1.66, -0.12] });
      break;
    case 'cap':
      s.use('plain', WHITE);
      s.sphere([0.238, 0.17, 0.255], { at: [0, 1.712, -0.008] }, 6);
      s.box(0.2, 0.014, 0.11, { at: [0, 1.707, 0.14], rot: [0.12, 0, 0] });
      s.use('poly', grey(0.6)).box(0.04, 0.04, 0.012, { at: [0, 1.745, 0.118] });
      break;
    case 'beanie':
      s.use('plain', WHITE);
      s.sphere([0.238, 0.21, 0.25], { at: [0, 1.7, -0.004] }, 6);
      s.use('poly', grey(0.8)).box(0.235, 0.04, 0.245, { at: [0, 1.655, -0.004] });
      break;
    case 'helmet':
      s.use('poly', WHITE);
      s.sphere([0.275, 0.2, 0.315], { at: [0, 1.722, -0.014] }, 7);
      s.box(0.27, 0.018, 0.3, { at: [0, 1.668, -0.006] });
      s.use('poly', grey(0.25));
      s.box(0.05, 0.05, 0.04, { at: [0, 1.745, 0.148] });
      for (const side of [-1, 1]) {
        s.box(0.012, 0.045, 0.1, { at: [side * 0.137, 1.7, 0.0] });
        s.box(0.012, 0.1, 0.012, { at: [side * 0.1, 1.6, 0.04], rot: [0, 0, side * 0.1] });
      }
      s.box(0.15, 0.012, 0.012, { at: [0, 1.55, 0.095] });
      s.use('poly', grey(0.6)).box(0.04, 0.012, 0.03, { at: [0, 1.668, 0.156] });
      break;
    case 'vest':
      s.use('poly', WHITE);
      s.box(0.385, 0.35, 0.075, { at: [0, 1.28, 0.175] });
      s.box(0.385, 0.35, 0.07, { at: [0, 1.28, -0.168] });
      for (const side of [-1, 1]) {
        s.box(0.095, 0.045, 0.36, { at: [side * 0.14, 1.46, 0.0] });
        s.box(0.04, 0.3, 0.255, { at: [side * 0.225, 1.2, 0.0] });
      }
      s.box(0.44, 0.15, 0.285, { at: [0, 1.1, 0.0] });
      s.use('poly', grey(0.55));
      for (const x of [-0.115, 0, 0.115]) s.box(0.095, 0.12, 0.05, { at: [x, 1.14, 0.222] });
      s.use('poly', grey(0.35)).box(0.2, 0.05, 0.02, { at: [0, 1.4, 0.218] });
      break;
    case 'thigh':
      cloth().box(0.175, 0.44, 0.195, { at: [0, -0.22, 0] });
      gear([0.55, 0.57, 0.5]).box(0.035, 0.15, 0.14, { at: [0.1, -0.2, 0.0] });
      gear([0.55, 0.57, 0.5]).box(0.035, 0.15, 0.14, { at: [-0.1, -0.2, 0.0] });
      gear(grey(0.22)).box(0.16, 0.09, 0.05, { at: [0, -0.43, 0.095] });
      break;
    case 'shin':
      cloth().box(0.15, 0.42, 0.165, { at: [0, -0.21, 0] });
      cloth().box(0.165, 0.05, 0.185, { at: [0, -0.4, 0] });
      gear(grey(0.14)).box(0.16, 0.12, 0.29, { at: [0, -0.46, 0.05] });
      gear(grey(0.07)).box(0.17, 0.03, 0.31, { at: [0, -0.505, 0.05] });
      gear(grey(0.28)).box(0.08, 0.06, 0.1, { at: [0, -0.425, 0.12] });
      break;
    case 'upper':
      cloth().box(0.12, ARM_UPPER, 0.13, { at: [0, -ARM_UPPER / 2 + 0.01, 0] });
      cloth().sphere([0.13, 0.13, 0.13], { at: [0, 0, 0] }, 5);
      break;
    case 'fore':
      cloth().box(0.105, ARM_FORE * 0.9, 0.115, { at: [0, -ARM_FORE * 0.45, 0] });
      gear(grey(0.2)).sphere([0.1, 0.1, 0.1], { at: [0, 0, -0.02] }, 4);
      gear(grey(0.14)).box(0.11, 0.1, 0.13, { at: [0, -ARM_FORE - 0.0, 0.0] });
      gear(grey(0.16)).box(0.04, 0.07, 0.06, { at: [0.0, -ARM_FORE - 0.02, 0.07] });
      break;
  }
  return bag;
}
