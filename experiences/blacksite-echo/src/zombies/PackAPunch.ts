import { PACK_A_PUNCH_COST } from './zombiesData';

export class PackAPunch {
  private upgraded = new Set<string>();

  reset(): void {
    this.upgraded.clear();
  }

  get cost(): number {
    return PACK_A_PUNCH_COST;
  }

  isUpgraded(weaponId: string): boolean {
    return this.upgraded.has(weaponId);
  }

  canUpgrade(weaponId: string, powerOn: boolean): boolean {
    return powerOn && !this.upgraded.has(weaponId);
  }

  upgrade(weaponId: string): boolean {
    if (this.upgraded.has(weaponId)) return false;
    this.upgraded.add(weaponId);
    return true;
  }

  damageMultiplier(weaponId: string): number {
    return this.upgraded.has(weaponId) ? 2 : 1;
  }

  ammoMultiplier(weaponId: string): number {
    return this.upgraded.has(weaponId) ? 1.5 : 1;
  }
}
