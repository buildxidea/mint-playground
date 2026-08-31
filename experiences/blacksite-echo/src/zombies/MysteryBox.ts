import {
  BOX_EXCLUSIVE_WEAPON_IDS,
  BOX_WEAPON_POOL,
  type WeaponId,
} from '../data/weapons';
import { BOX_MOVE_AFTER_USES } from './zombiesData';

export type MysteryBoxState = 'idle' | 'spinning' | 'presenting' | 'moving';

export type MysteryBoxResult =
  | { type: 'spinning' }
  | { type: 'grant'; weaponId: WeaponId }
  | { type: 'teddy-move'; locationIndex: number }
  | null;

export class MysteryBox {
  state: MysteryBoxState = 'idle';
  uses = 0;
  locationIndex = 0;
  presentedWeapon: WeaponId | null = null;
  private spinTimer = 0;
  private readonly locationCount: number;
  private readonly rng: () => number;

  constructor(locationCount: number, rng: () => number = Math.random) {
    this.locationCount = Math.max(1, locationCount);
    this.rng = rng;
  }

  reset(): void {
    this.state = 'idle';
    this.uses = 0;
    this.locationIndex = 0;
    this.presentedWeapon = null;
    this.spinTimer = 0;
  }

  startSpin(excludeWeaponId?: string): MysteryBoxResult {
    if (this.state !== 'idle') return null;
    this.state = 'spinning';
    this.spinTimer = 4;
    this.presentedWeapon = this.pickWeapon(excludeWeaponId);
    return { type: 'spinning' };
  }

  update(delta: number): MysteryBoxResult {
    if (this.state === 'spinning') {
      this.spinTimer -= delta;
      if (this.spinTimer <= 0) {
        this.uses += 1;
        if (this.uses >= BOX_MOVE_AFTER_USES) {
          this.uses = 0;
          this.locationIndex = (this.locationIndex + 1) % this.locationCount;
          this.state = 'idle';
          this.presentedWeapon = null;
          return { type: 'teddy-move', locationIndex: this.locationIndex };
        }
        this.state = 'presenting';
        this.spinTimer = 6;
        if (this.presentedWeapon) {
          return { type: 'grant', weaponId: this.presentedWeapon };
        }
      }
    } else if (this.state === 'presenting') {
      this.spinTimer -= delta;
      if (this.spinTimer <= 0) {
        this.state = 'idle';
        this.presentedWeapon = null;
      }
    }
    return null;
  }

  private pickWeapon(excludeWeaponId?: string): WeaponId {
    const pool = BOX_WEAPON_POOL.filter((id) => id !== excludeWeaponId);
    // Bias toward exclusives so the box feels distinct from wall buys (~40%).
    const exclusiveSet = new Set<string>(BOX_EXCLUSIVE_WEAPON_IDS);
    const exclusives = pool.filter((id) => exclusiveSet.has(id));
    const wall = pool.filter((id) => !exclusiveSet.has(id));
    const useExclusive = this.rng() < 0.4 && exclusives.length > 0;
    const biased = useExclusive ? exclusives : wall.length > 0 ? wall : pool;
    const choice = biased[Math.floor(this.rng() * biased.length)] ?? 'arx-7';
    return choice;
  }
}
