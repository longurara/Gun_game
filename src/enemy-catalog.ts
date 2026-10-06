/** Stable cosmetic choices only. No change to bots' weapons, hitboxes or AI. */
export const ENEMY_MODELS = [
  { id: 'swat', label: 'Đặc nhiệm', file: 'assets/free/swat.glb', rig: 'quaternius' },
  { id: 'punk', label: 'Băng nhóm', file: 'assets/enemies/punk.glb', rig: 'quaternius' },
  { id: 'hoodie', label: 'Trinh sát', file: 'assets/enemies/hoodie.glb', rig: 'quaternius' },
  { id: 'woman-soldier', label: 'Nữ đặc nhiệm', file: 'assets/enemies/woman-soldier.glb', rig: 'quaternius' },
  { id: 'woman-punk', label: 'Nữ lính đánh thuê', file: 'assets/enemies/woman-punk.glb', rig: 'quaternius' },
  { id: 'toon-soldier', label: 'Lính chiến', file: 'assets/enemies/toon-soldier.glb', rig: 'quaternius' },
  { id: 'toon-hazmat', label: 'Lính phòng hóa', file: 'assets/enemies/toon-hazmat.glb', rig: 'quaternius' },
  { id: 'toon-enemy', label: 'Đột kích', file: 'assets/enemies/toon-enemy.glb', rig: 'quaternius' },
  { id: 'survivor-female', label: 'Nữ sinh tồn', file: 'assets/enemies/kenney-character.glb', rig: 'kenney', texture: 'survivorFemaleA.png' },
  { id: 'survivor-male', label: 'Lính sinh tồn', file: 'assets/enemies/kenney-character.glb', rig: 'kenney', texture: 'survivorMaleB.png' },
  { id: 'zombie-a', label: 'Nhiễm độc', file: 'assets/enemies/kenney-character.glb', rig: 'kenney', texture: 'zombieA.png' },
  { id: 'zombie-c', label: 'Nhiễm độc nặng', file: 'assets/enemies/kenney-character.glb', rig: 'kenney', texture: 'zombieC.png' },
] as const;
export type EnemyModel = typeof ENEMY_MODELS[number];
export type EnemyModelId = EnemyModel['id'];

export function enemyModelFor(id: string): EnemyModel | null {
  if (id.startsWith('dummy')) return null;
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ENEMY_MODELS[(hash >>> 0) % ENEMY_MODELS.length];
}

/** Detailed rigs are limited to the closest enemies; distant bodies use batched instances. */
export function enemyDetailBudget(touch: boolean, lowQuality: boolean) {
  return { distance: touch || lowQuality ? 35 : 65, count: touch || lowQuality ? 8 : 16 };
}
