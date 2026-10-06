import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export function swatHands(nodes: TransformNode[]) {
  return ['L', 'R'].map((side, index) => {
    const wrist = nodes.find(node => node.name.endsWith(`-Wrist.${side}`));
    return {
      wrist, scale: wrist?.scaling.clone(),
      fingers: nodes.filter(node => new RegExp(`-(Index|Middle|Ring|Pinky|Thumb)[1-4]\\.${side}$`).test(node.name))
        .map(node => {
          const segment = Number(node.name.match(/([1-4])\.[LR]$/)?.[1]);
          const thumb = node.name.includes('Thumb'), trigger = index === 1 && node.name.includes('Index');
          const curl = segment === 1 ? 0 : thumb ? .55 : trigger ? (segment === 2 ? .35 : .65) : segment === 2 ? .9 : segment === 3 ? 1.05 : .5;
          return { node, grip: node.rotationQuaternion!.multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), -curl)) };
        }),
    };
  });
}

/** Palm contact points are different from the wrist joint used by arm IK. */
export function gripWristOffset(side: number, pistol: boolean): Vector3 {
  return side ? new Vector3(.065, .025, -.15) : pistol ? new Vector3(-.065, .025, -.15) : new Vector3(-.125, -.015, 0);
}

/** Orient and close the hand around a +Z-facing weapon, including mirrored GLB parents. */
export function poseSwatHand(hand: ReturnType<typeof swatHands>[number], side: number, weaponWorld: Matrix, pistol: boolean): void {
  const wrist = hand.wrist;
  if (!wrist?.parent || !hand.scale) return;
  wrist.scaling.copyFrom(hand.scale).scaleInPlace(.75);
  const inverse = (wrist.parent as TransformNode).computeWorldMatrix(true).clone().invert();
  const transform = weaponWorld.multiply(inverse);
  const y = Vector3.TransformNormal(side || pistol ? new Vector3(0, -.25, 1) : new Vector3(1, 0, 0), transform).normalize();
  const z = Vector3.TransformNormal(side ? new Vector3(1, 0, 0) : pistol ? new Vector3(-1, 0, 0) : new Vector3(0, -1, 0), transform).normalize();
  const x = Vector3.Cross(y, z).normalize();
  Vector3.CrossToRef(x, y, z); z.normalize();
  wrist.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(x, y, z);
  for (const finger of hand.fingers) finger.node.rotationQuaternion!.copyFrom(finger.grip);
}
