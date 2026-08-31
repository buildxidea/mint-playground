import type { PerkId } from './zombiesData';

export class PerkSystem {
  private owned = new Set<PerkId>();

  reset(): void {
    this.owned.clear();
  }

  purchase(perkId: PerkId): boolean {
    if (this.owned.has(perkId)) return false;
    this.owned.add(perkId);
    return true;
  }

  has(perkId: PerkId): boolean {
    return this.owned.has(perkId);
  }

  list(): PerkId[] {
    return [...this.owned];
  }

  maxHealth(): number {
    return this.has('juggernog') ? 250 : 100;
  }

  reloadScale(): number {
    return this.has('speed') ? 0.5 : 1;
  }

  fireRateScale(): number {
    return this.has('doubletap') ? 1.33 : 1;
  }

  canSelfRevive(): boolean {
    return this.has('revive');
  }

  consumeSelfRevive(): void {
    this.owned.delete('revive');
  }
}
