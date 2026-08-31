import * as THREE from 'three';
import {
  POWER_UP_DURATION,
  randomPowerUpKind,
  shouldDropPowerUp,
  type PowerUpKind,
} from './zombiesData';
import { POWER_UP_PRESENTATIONS } from './PowerUpCatalog';
import { createPowerUpPresentation } from './PowerUpPresentation';

export type PowerUpEvent =
  | { type: 'pickup'; kind: PowerUpKind }
  | { type: 'expired'; kind: PowerUpKind }
  | { type: 'nuke' }
  | { type: 'carpenter' }
  | { type: 'max-ammo' };

type ActiveEffect = { kind: PowerUpKind; remaining: number };

type Pickup = {
  kind: PowerUpKind;
  mesh: THREE.Group;
  baseY: number;
  phase: number;
  life: number;
};

export type PowerUpHudState = {
  active: Array<{
    kind: PowerUpKind;
    label: string;
    remaining: number;
    duration: number;
  }>;
  toast: {
    kind: PowerUpKind;
    label: string;
    description: string;
    sequence: number;
  } | null;
};

const PICKUP_LIFETIME_SECONDS = 25;
const PICKUP_TOAST_SECONDS = 2.4;

export class PowerUpSystem {
  activeBanner = '';
  private pickups: Pickup[] = [];
  private effects: ActiveEffect[] = [];
  private pityKills = 0;
  private scene: THREE.Scene | null = null;
  private spin = 0;
  private toast: PowerUpHudState['toast'] = null;
  private toastRemaining = 0;
  private toastSequence = 0;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  reset(): void {
    for (const pickup of this.pickups) pickup.mesh.removeFromParent();
    this.pickups = [];
    this.effects = [];
    this.pityKills = 0;
    this.activeBanner = '';
    this.toast = null;
    this.toastRemaining = 0;
    this.toastSequence = 0;
  }

  get instaKillActive(): boolean {
    return this.effects.some((e) => e.kind === 'insta-kill' && e.remaining > 0);
  }

  get doublePointsActive(): boolean {
    return this.effects.some((e) => e.kind === 'double-points' && e.remaining > 0);
  }

  getHudState(): PowerUpHudState {
    return {
      active: this.effects
        .filter((effect) => effect.remaining > 0)
        .map((effect) => ({
          kind: effect.kind,
          label: POWER_UP_PRESENTATIONS[effect.kind].label,
          remaining: effect.remaining,
          duration: POWER_UP_DURATION,
        })),
      toast: this.toast ? { ...this.toast } : null,
    };
  }

  onKill(position: THREE.Vector3, rng: () => number): void {
    this.pityKills += 1;
    if (!shouldDropPowerUp(rng, this.pityKills)) return;
    this.pityKills = 0;
    this.spawnPickup(randomPowerUpKind(rng), position);
  }

  spawnPickup(kind: PowerUpKind, position: THREE.Vector3): void {
    const mesh = createPowerUpPresentation(kind);
    mesh.position.copy(position);
    mesh.position.y += 0.9;
    this.scene?.add(mesh);
    this.pickups.push({
      kind,
      mesh,
      baseY: mesh.position.y,
      phase: this.pickups.length * 1.37,
      life: PICKUP_LIFETIME_SECONDS,
    });
  }

  update(delta: number, playerPosition: THREE.Vector3): PowerUpEvent[] {
    const events: PowerUpEvent[] = [];
    this.spin += delta * 2.4;

    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (!pickup) continue;
      pickup.life -= delta;
      pickup.mesh.rotation.y = this.spin + pickup.phase;
      pickup.mesh.position.y =
        pickup.baseY + Math.sin(this.spin * 1.55 + pickup.phase) * 0.075;
      const aura = pickup.mesh.getObjectByName('powerup-aura');
      if (aura) {
        const pulse = 1 + Math.sin(this.spin * 2.4 + pickup.phase) * 0.09;
        aura.scale.setScalar(pulse);
      }
      if (playerPosition.distanceTo(pickup.mesh.position) < 1.6) {
        events.push(...this.activate(pickup.kind));
        pickup.mesh.removeFromParent();
        this.pickups.splice(i, 1);
        continue;
      }
      if (pickup.life <= 0) {
        pickup.mesh.removeFromParent();
        this.pickups.splice(i, 1);
      }
    }

    this.toastRemaining = Math.max(0, this.toastRemaining - delta);
    if (this.toastRemaining <= 0) this.toast = null;

    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      if (!effect) continue;
      effect.remaining -= delta;
      if (effect.remaining <= 0) {
        events.push({ type: 'expired', kind: effect.kind });
        this.effects.splice(i, 1);
      }
    }

    const timed = this.effects.find((e) => e.remaining > 0);
    this.activeBanner = timed
      ? `${timed.kind.replaceAll('-', ' ').toUpperCase()} // ${timed.remaining.toFixed(0)}s`
      : '';

    return events;
  }

  private activate(kind: PowerUpKind): PowerUpEvent[] {
    const events: PowerUpEvent[] = [{ type: 'pickup', kind }];
    const spec = POWER_UP_PRESENTATIONS[kind];
    this.toastSequence += 1;
    this.toast = {
      kind,
      label: spec.label,
      description: spec.effectCopy,
      sequence: this.toastSequence,
    };
    this.toastRemaining = PICKUP_TOAST_SECONDS;
    if (kind === 'nuke') {
      events.push({ type: 'nuke' });
      return events;
    }
    if (kind === 'carpenter') {
      events.push({ type: 'carpenter' });
      return events;
    }
    if (kind === 'max-ammo') {
      events.push({ type: 'max-ammo' });
      return events;
    }
    this.effects = this.effects.filter((e) => e.kind !== kind);
    this.effects.push({ kind, remaining: POWER_UP_DURATION });
    return events;
  }
}
