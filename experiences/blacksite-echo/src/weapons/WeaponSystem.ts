import type { InputController } from '../core/InputController';
import {
  deriveWeaponRuntime,
  getWeapon,
  type WeaponDefinition,
  type WeaponId,
} from '../data/weapons';
import type { WeaponLoadout } from '../game/types';

export type WeaponState =
  | 'equipping'
  | 'idle'
  | 'aiming'
  | 'firing'
  | 'cycling'
  | 'reloading'
  | 'sprinting'
  | 'inspecting'
  | 'melee';

export type WeaponEvent =
  | { type: 'shot'; weapon: WeaponDefinition }
  | { type: 'dry'; weapon: WeaponDefinition }
  | { type: 'reload'; weapon: WeaponDefinition }
  | { type: 'melee'; weapon: WeaponDefinition }
  | { type: 'equipment' };

type AmmoState = { magazine: number; reserve: number };

export type WeaponSlotSnapshot = {
  slot: 0 | 1;
  weapon: WeaponDefinition;
  ammo: AmmoState;
  active: boolean;
};

export class WeaponSystem {
  state: WeaponState = 'equipping';
  stateTime = 0;
  adsFactor = 0;
  shotPulse = 0;
  reloadProgress = 0;
  currentSlot: 0 | 1 = 0;

  private loadout: WeaponLoadout;
  private primary: WeaponDefinition;
  private sidearm: WeaponDefinition;
  private availableSlots: 1 | 2 = 2;
  private readonly ammo = new Map<WeaponId, AmmoState>();
  private cooldown = 0;
  private stateDuration = 0;
  private perkReloadScale = 1;
  private perkFireRateScale = 1;

  constructor(loadout: WeaponLoadout) {
    this.loadout = structuredClone(loadout);
    this.primary = this.buildWeapon(loadout.primaryId);
    this.sidearm = this.buildWeapon(loadout.sidearmId);
    this.resetAmmo();
    this.enterState('equipping', this.current.equipSeconds);
  }

  get current(): WeaponDefinition {
    return this.currentSlot === 0 ? this.primary : this.sidearm;
  }

  get ammoState(): AmmoState {
    return this.ammo.get(this.current.id)!;
  }

  get stateProgress(): number {
    if (this.stateDuration <= 0) return 0;
    return Math.min(1, this.stateTime / this.stateDuration);
  }

  get slots(): WeaponSlotSnapshot[] {
    const slots: WeaponSlotSnapshot[] = [
      {
        slot: 0,
        weapon: this.primary,
        ammo: { ...this.ammo.get(this.primary.id)! },
        active: this.currentSlot === 0,
      },
      {
        slot: 1,
        weapon: this.sidearm,
        ammo: { ...this.ammo.get(this.sidearm.id)! },
        active: this.currentSlot === 1,
      },
    ];
    return slots.slice(0, this.availableSlots);
  }

  get slotCount(): number {
    return this.availableSlots;
  }

  setLoadout(loadout: WeaponLoadout): void {
    this.loadout = structuredClone(loadout);
    this.primary = this.buildWeapon(loadout.primaryId);
    this.sidearm = this.buildWeapon(loadout.sidearmId);
    this.availableSlots = 2;
    this.currentSlot = 0;
    this.resetAmmo();
    this.enterState('equipping', this.current.equipSeconds);
  }

  setZombiesStarter(): void {
    const pistol = this.buildWeapon('aegis-p11');
    this.primary = pistol;
    this.sidearm = this.buildWeapon('aegis-p11');
    this.availableSlots = 1;
    this.currentSlot = 0;
    this.resetAmmo();
    this.enterState('equipping', this.current.equipSeconds);
  }

  grantWeapon(weaponId: WeaponId, ammoOnly = false): void {
    const existingSlot =
      this.primary.id === weaponId
        ? 0
        : this.availableSlots === 2 && this.sidearm.id === weaponId
          ? 1
          : null;
    if (existingSlot !== null) {
      this.ensureAmmo(weaponId, true);
      if (!ammoOnly) this.switchTo(existingSlot);
      return;
    }
    if (this.availableSlots === 1) {
      this.sidearm = this.buildWeapon(weaponId);
      this.availableSlots = 2;
      this.currentSlot = 1;
    } else if (this.currentSlot === 0) {
      this.primary = this.buildWeapon(weaponId);
    } else {
      this.sidearm = this.buildWeapon(weaponId);
    }
    this.ensureAmmo(weaponId, true);
    this.enterState('equipping', this.current.equipSeconds);
  }

  refillAllAmmo(): void {
    for (const slot of this.slots) {
      this.ensureAmmo(slot.weapon.id, true);
    }
  }

  upgradeHeldWeapon(): void {
    const weapon = this.current;
    weapon.damage = Math.round(weapon.damage * 2);
    weapon.minimumDamage = Math.round(weapon.minimumDamage * 2);
    weapon.magazineSize = Math.round(weapon.magazineSize * 1.5);
    weapon.reserve = Math.round(weapon.reserve * 1.5);
    weapon.name = `${weapon.name} CAMO`;
    this.ensureAmmo(weapon.id, true);
  }

  setPerkScales(reloadScale: number, fireRateScale: number): void {
    this.perkReloadScale = Math.max(0.2, reloadScale);
    this.perkFireRateScale = Math.max(0.2, fireRateScale);
  }

  private ensureAmmo(weaponId: WeaponId, full: boolean): void {
    const weapon =
      this.primary.id === weaponId
        ? this.primary
        : this.sidearm.id === weaponId
          ? this.sidearm
          : this.buildWeapon(weaponId);
    const existing = this.ammo.get(weaponId);
    if (full || !existing) {
      this.ammo.set(weaponId, {
        magazine: weapon.magazineSize,
        reserve: weapon.reserve,
      });
      return;
    }
    existing.magazine = weapon.magazineSize;
    existing.reserve = Math.max(existing.reserve, Math.floor(weapon.reserve * 0.55));
  }

  update(
    delta: number,
    input: InputController,
    sprinting: boolean,
    wantsAim: boolean,
  ): WeaponEvent[] {
    const events: WeaponEvent[] = [];
    this.stateTime += delta;
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.shotPulse = Math.max(0, this.shotPulse - delta * 12);
    this.adsFactor +=
      (Number(wantsAim && this.state !== 'reloading' && this.state !== 'sprinting') -
        this.adsFactor) *
      Math.min(1, delta * (8 + this.current.stats.handling * 0.08));

    if (input.wasPressed('KeyQ')) {
      this.switchTo(this.currentSlot === 0 ? 1 : 0);
    } else if (input.wasPressed('Digit1') && this.currentSlot !== 0) {
      this.switchTo(0);
    } else if (
      input.wasPressed('Digit2') &&
      this.availableSlots === 2 &&
      this.currentSlot !== 1
    ) {
      this.switchTo(1);
    }
    if (input.wasPressed('KeyR')) this.beginReload(events);
    if (input.wasPressed('KeyF') && this.state === 'idle') {
      this.enterState('inspecting', 1.8);
    }
    const wantsMelee =
      input.wasPressed('KeyV') || input.wasMousePressed(1);
    if (
      wantsMelee &&
      this.state !== 'reloading' &&
      this.state !== 'melee'
    ) {
      this.enterState('melee', 0.46);
      events.push({ type: 'melee', weapon: this.current });
    }
    if (input.wasPressed('KeyG')) events.push({ type: 'equipment' });

    if (this.state === 'reloading') {
      this.reloadProgress = Math.min(1, this.stateTime / Math.max(0.01, this.stateDuration));
      if (this.current.fireMode === 'shotgun' && input.wasMousePressed(0)) {
        this.enterState('idle');
      } else if (this.stateTime >= this.stateDuration) {
        this.completeReload(events);
      }
      return events;
    }

    if (
      ['equipping', 'cycling', 'inspecting', 'melee'].includes(this.state) &&
      this.stateTime >= this.stateDuration
    ) {
      this.enterState('idle');
    }

    if (sprinting && this.state === 'idle') this.enterState('sprinting');
    if (!sprinting && this.state === 'sprinting') this.enterState('idle');

    const wantsFire =
      this.current.fireMode === 'auto' ? input.isMouseDown(0) : input.wasMousePressed(0);
    const canFire =
      wantsFire &&
      this.cooldown <= 0 &&
      !['equipping', 'reloading', 'inspecting', 'melee'].includes(this.state);
    if (canFire) {
      if (this.ammoState.magazine <= 0) {
        this.cooldown = 0.24;
        events.push({ type: 'dry', weapon: this.current });
      } else {
        this.ammoState.magazine -= 1;
        this.cooldown = 60 / (this.current.roundsPerMinute * this.perkFireRateScale);
        this.shotPulse = 1;
        this.enterState(
          this.current.fireMode === 'shotgun' ? 'cycling' : 'firing',
          this.current.fireMode === 'shotgun' ? 0.44 : 0.075,
        );
        events.push({ type: 'shot', weapon: this.current });
      }
    }

    if (this.state === 'firing' && this.stateTime >= this.stateDuration) {
      this.enterState(wantsAim ? 'aiming' : 'idle');
    } else if (this.state === 'idle' && wantsAim) {
      this.state = 'aiming';
    } else if (this.state === 'aiming' && !wantsAim) {
      this.state = 'idle';
    }
    return events;
  }

  refillAtCheckpoint(): void {
    for (const { weapon } of this.slots) {
      const ammo = this.ammo.get(weapon.id);
      if (!ammo) continue;
      ammo.magazine = weapon.magazineSize;
      ammo.reserve = Math.max(ammo.reserve, Math.floor(weapon.reserve * 0.55));
    }
  }

  snapshotAmmo(): Record<string, AmmoState> {
    return Object.fromEntries(
      Array.from(this.ammo.entries()).map(([id, value]) => [id, { ...value }]),
    );
  }

  restoreAmmo(snapshot: Record<string, AmmoState>): void {
    for (const [id, value] of Object.entries(snapshot)) {
      this.ammo.set(id as WeaponId, { ...value });
    }
    this.enterState('equipping', this.current.equipSeconds);
  }

  private switchTo(slot: 0 | 1): void {
    if (slot === 1 && this.availableSlots < 2) return;
    this.currentSlot = slot;
    this.enterState('equipping', this.current.equipSeconds);
  }

  private beginReload(events: WeaponEvent[]): void {
    const ammo = this.ammoState;
    if (
      ammo.magazine >= this.current.magazineSize ||
      ammo.reserve <= 0 ||
      this.state === 'reloading'
    ) {
      return;
    }
    this.enterState('reloading', this.current.reloadSeconds * this.perkReloadScale);
    this.reloadProgress = 0;
    events.push({ type: 'reload', weapon: this.current });
  }

  private completeReload(events: WeaponEvent[]): void {
    const ammo = this.ammoState;
    if (this.current.fireMode === 'shotgun') {
      ammo.magazine += 1;
      ammo.reserve -= 1;
      if (ammo.magazine < this.current.magazineSize && ammo.reserve > 0) {
        this.enterState('reloading', this.current.reloadSeconds * this.perkReloadScale);
        events.push({ type: 'reload', weapon: this.current });
        return;
      }
    } else {
      const need = this.current.magazineSize - ammo.magazine;
      const moved = Math.min(need, ammo.reserve);
      ammo.magazine += moved;
      ammo.reserve -= moved;
    }
    this.reloadProgress = 0;
    this.enterState('idle');
  }

  private enterState(state: WeaponState, duration = 0): void {
    this.state = state;
    this.stateTime = 0;
    this.stateDuration = duration;
  }

  private buildWeapon(id: string): WeaponDefinition {
    const base = getWeapon(id);
    const attachments = this.loadout.attachments[base.id];
    return deriveWeaponRuntime(base, attachments);
  }

  private resetAmmo(): void {
    this.ammo.clear();
    for (const { weapon } of this.slots) {
      this.ammo.set(weapon.id, {
        magazine: weapon.magazineSize,
        reserve: weapon.reserve,
      });
    }
  }
}
