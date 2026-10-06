/** Selected CC0 structures. Dimensions are metres; solid boxes reserve physical cover separately from visual pieces. */
export const LANDMARK_SPECS = {
  fountain: {
    label: 'Đài nước', width: 4.8, depth: 4.8, height: 1.6,
    pieces: [{ model: 'k-town-fountain', x: 0, y: 0, z: 0, width: 4.8, height: 1.6, depth: 4.8 }],
    solids: [{ x: 0, z: 0, width: 4.8, depth: 4.8, bottom: 0, height: 0.7 }, { x: 0, z: 0, width: 1, depth: 1, bottom: 0.7, height: 1.6 }],
  },
  crypt: {
    label: 'Nhà tưởng niệm', width: 6.01, depth: 5.76, height: 6.96,
    pieces: [
      { model: 'k-crypt-small', x: 0, y: 0, z: 0, width: 5.4, height: 4, depth: 5.6 },
      { model: 'k-crypt-roof', x: 0, y: 4, z: 0, width: 6.01, height: 2.96, depth: 5.76 },
      { model: 'k-crypt-door', x: -0.95, y: 0, z: 2.1, width: 1.32, height: 2.951, depth: 0.5, yaw: Math.PI / 2 },
    ],
    solids: [
      { x: -2, z: 0, width: 0.35, depth: 4.2, bottom: 0, height: 4 },
      { x: 2, z: 0, width: 0.35, depth: 4.2, bottom: 0, height: 4 },
      { x: 0, z: -2.1, width: 4, depth: 0.35, bottom: 0, height: 4 },
      ...[-1, 1].map(x => ({ x: x * 1.35, z: 2.1, width: 1.3, depth: 0.35, bottom: 0, height: 4 })),
      { x: 0, z: 2.1, width: 1.4, depth: 0.35, bottom: 2.95, height: 4 },
      { x: -0.95, z: 2.1, width: 0.5, depth: 1.32, bottom: 0, height: 2.951 },
      ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 2, z: z * 2.1, width: 1.4, depth: 1.4, bottom: 0, height: 4 }))),
    ],
  },
  obelisk: {
    label: 'Bia tưởng niệm', width: 2.2, depth: 2.2, height: 6,
    pieces: [{ model: 'k-obelisk', x: 0, y: 0, z: 0, width: 2.2, height: 6, depth: 2.2 }],
    solids: [{ x: 0, z: 0, width: 2.2, depth: 2.2, bottom: 0, height: 1 }, { x: 0, z: 0, width: 1.15, depth: 1.15, bottom: 1, height: 6 }],
  },
  waterTower: {
    label: 'Tháp nước', width: 5, depth: 5, height: 13,
    pieces: [{ model: 'k-water-tower', x: 0, y: 0, z: 0, width: 5, height: 13, depth: 5 }],
    solids: [
      ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 1.93, z: z * 1.68, width: 1.14, depth: 1.17, bottom: 0, height: 8 }))),
      { x: 0, z: 0, width: 5, depth: 5, bottom: 7.5, height: 13 },
    ],
  },
  stoneCourt: {
    label: 'Sân tường đá', width: 10, depth: 9, height: 3,
    pieces: [
      { model: 'k-fort-wall', x: 0, y: 0, z: 4.25, width: 10, height: 3, depth: 0.5 },
      ...[-1, 1].map(x => ({ model: 'k-fort-wall' as const, x: x * 4.75, y: 0, z: 0, width: 9, height: 3, depth: 0.5, yaw: Math.PI / 2 })),
      ...[-1, 1].map(x => ({ model: 'k-fort-wall' as const, x: x * 3.25, y: 0, z: -4.25, width: 3.5, height: 3, depth: 0.5 })),
    ],
    solids: [
      { x: 0, z: 4.25, width: 10, depth: 0.5, bottom: 0, height: 3 },
      ...[-1, 1].map(x => ({ x: x * 4.75, z: 0, width: 0.5, depth: 9, bottom: 0, height: 3 })),
      ...[-1, 1].map(x => ({ x: x * 3.25, z: -4.25, width: 3.5, depth: 0.5, bottom: 0, height: 3 })),
    ],
  },
  scaffold: {
    label: 'Khung công trình', width: 5, depth: 5, height: 6,
    pieces: [{ model: 'k-scaffold', x: 0, y: 0, z: 0, width: 5, height: 6, depth: 5 }],
    solids: [
      ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 2.325, z: z * 2.325, width: 0.35, depth: 0.35, bottom: 0, height: 6 }))),
      ...[-1, 1].map(z => ({ x: 0, z: z * 2.325, width: 5, depth: 0.3, bottom: 5.7, height: 6 })),
      ...[-1, 1].map(x => ({ x: x * 2.325, z: 0, width: 0.3, depth: 5, bottom: 5.7, height: 6 })),
    ],
  },
} as const;
export type LandmarkKind = keyof typeof LANDMARK_SPECS;
