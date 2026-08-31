import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import {
  DOOR_COSTS,
  MYSTERY_BOX_COST,
  PACK_A_PUNCH_COST,
  PERK_COSTS,
  PERK_LABELS,
  wallBuyDefFor,
  type BuyableKind,
  type PerkId,
  type ZoneId,
} from './zombiesData';
import type { PointsEconomy } from './PointsEconomy';

export type BuyableEvent =
  | { type: 'wall-buy'; weaponId: string; cost: number; ammoOnly: boolean }
  | { type: 'door'; doorId: string; unlocks: ZoneId; cost: number }
  | { type: 'barrier-repair'; barrierId: string; cost: number }
  | { type: 'power-on' }
  | { type: 'power-retrigger' }
  | { type: 'mystery-box'; cost: number }
  | { type: 'perk'; perkId: PerkId; cost: number }
  | { type: 'pack-a-punch'; cost: number };

export type RoomNavigationState = {
  currentRoom: { id: ZoneId; label: string };
  target: {
    doorId: string;
    roomId: ZoneId;
    label: string;
    position: THREE.Vector3;
    distance: number;
    cost: number;
  } | null;
  rooms: Array<{
    id: ZoneId;
    label: string;
    unlocked: boolean;
    active: boolean;
  }>;
};

export type BuyableProgressionState = {
  powerOn: boolean;
  openDoorIds: string[];
};

type Buyable = {
  id: string;
  kind: BuyableKind;
  position: THREE.Vector3;
  radius: number;
  cost: number;
  label: string;
  requiresPower: boolean;
  weaponId?: string;
  ammoCost?: number;
  unlocks?: ZoneId;
  perkId?: PerkId;
  open?: boolean;
  boards?: number;
};

const ROOM_ROUTE: Array<{
  roomId: ZoneId;
  label: string;
  doorId?: string;
}> = [
  { roomId: 'spawn', label: 'Spawn' },
  { roomId: 'mid', label: 'Mid', doorId: 'door-spawn-mid' },
  { roomId: 'power', label: 'Power', doorId: 'door-mid-power' },
  { roomId: 'pap', label: 'Forge', doorId: 'door-power-pap' },
];

export class BuyableRegistry {
  interactionPrompt = '';
  interactionProgress = 0;
  powerOn = false;

  private buyables: Buyable[] = [];
  private ownedWeapons = new Set<string>(['aegis-p11']);
  private ownedPerks = new Set<PerkId>();

  configure(
    anchors: {
      wallBuys: { id: string; position: THREE.Vector3 }[];
      doors: {
        id: string;
        position: THREE.Vector3;
        interactionPosition?: THREE.Vector3;
        unlocks: ZoneId;
      }[];
      barriers: { id: string; position: THREE.Vector3 }[];
      powerSwitch: THREE.Vector3;
      mysteryBox: THREE.Vector3;
      perks: { perkId: PerkId; position: THREE.Vector3 }[];
      packAPunch: THREE.Vector3;
    },
  ): void {
    this.buyables = [];
    for (const wall of anchors.wallBuys) {
      const def = wallBuyDefFor(wall.id);
      if (!def) continue;
      this.buyables.push({
        id: wall.id,
        kind: 'wall-buy',
        position: wall.position.clone(),
        radius: 2.2,
        cost: def.cost,
        ammoCost: def.ammoCost,
        weaponId: def.weaponId,
        label: `Wall buy // ${def.weaponId}`,
        requiresPower: false,
      });
    }
    for (const door of anchors.doors) {
      this.buyables.push({
        id: door.id,
        kind: 'door',
        position: (door.interactionPosition ?? door.position).clone(),
        radius: 2.4,
        cost: DOOR_COSTS[door.id] ?? 1000,
        unlocks: door.unlocks,
        label: `Open door // ${DOOR_COSTS[door.id] ?? 1000}`,
        requiresPower: false,
        open: false,
      });
    }
    for (const barrier of anchors.barriers) {
      this.buyables.push({
        id: barrier.id,
        kind: 'barrier',
        position: barrier.position.clone(),
        radius: 2.0,
        cost: 10,
        label: 'Repair barrier // 10',
        requiresPower: false,
        boards: 5,
      });
    }
    const mapsLite =
      anchors.doors.length === 0 &&
      anchors.perks.length === 0 &&
      anchors.wallBuys.length >= 6;
    if (!mapsLite) {
      this.buyables.push({
        id: 'power-switch',
        kind: 'power-switch',
        position: anchors.powerSwitch.clone(),
        radius: 2.3,
        cost: 0,
        label: 'Restore facility power',
        requiresPower: false,
      });
    }
    this.buyables.push({
      id: 'mystery-box',
      kind: 'mystery-box',
      position: anchors.mysteryBox.clone(),
      radius: 2.4,
      cost: MYSTERY_BOX_COST,
      label: `Mystery cabinet // ${MYSTERY_BOX_COST}`,
      requiresPower: !mapsLite,
    });
    for (const perk of anchors.perks) {
      this.buyables.push({
        id: `perk-${perk.perkId}`,
        kind: 'perk',
        position: perk.position.clone(),
        radius: 2.3,
        cost: PERK_COSTS[perk.perkId],
        perkId: perk.perkId,
        label: `${PERK_LABELS[perk.perkId]} // ${PERK_COSTS[perk.perkId]}`,
        requiresPower: true,
      });
    }
    if (!mapsLite) {
      this.buyables.push({
        id: 'pack-a-punch',
        kind: 'pack-a-punch',
        position: anchors.packAPunch.clone(),
        radius: 2.4,
        cost: PACK_A_PUNCH_COST,
        label: `Forge upgrade // ${PACK_A_PUNCH_COST}`,
        requiresPower: true,
      });
    }
  }

  reset(): void {
    this.powerOn = false;
    this.interactionPrompt = '';
    this.interactionProgress = 0;
    this.ownedWeapons = new Set(['aegis-p11']);
    this.ownedPerks.clear();
    for (const buyable of this.buyables) {
      if (buyable.kind === 'door') buyable.open = false;
      if (buyable.kind === 'barrier') buyable.boards = 5;
    }
  }

  setMysteryBoxPosition(position: THREE.Vector3): void {
    const box = this.buyables.find((b) => b.kind === 'mystery-box');
    if (box) box.position.copy(position);
  }

  markWeaponOwned(weaponId: string): void {
    this.ownedWeapons.add(weaponId);
  }

  markPerkOwned(perkId: PerkId): void {
    this.ownedPerks.add(perkId);
  }

  getProgressionState(): BuyableProgressionState {
    return {
      powerOn: this.powerOn,
      openDoorIds: this.buyables
        .filter((buyable) => buyable.kind === 'door' && buyable.open)
        .map((buyable) => buyable.id),
    };
  }

  reserveInteraction(delta: number): void {
    this.interactionPrompt = '';
    this.interactionProgress = Math.max(
      0,
      this.interactionProgress - delta * 2,
    );
  }

  getRoomNavigation(playerPosition: THREE.Vector3): RoomNavigationState {
    let activeRoomIndex = 0;
    for (let index = 1; index < ROOM_ROUTE.length; index += 1) {
      const route = ROOM_ROUTE[index]!;
      const door = this.buyables.find(
        (buyable) => buyable.kind === 'door' && buyable.id === route.doorId,
      );
      if (!door?.open) break;
      activeRoomIndex = index;
    }

    const targetRoute = ROOM_ROUTE[activeRoomIndex + 1];
    const targetDoor = targetRoute?.doorId
      ? this.buyables.find(
          (buyable) =>
            buyable.kind === 'door' && buyable.id === targetRoute.doorId,
        )
      : null;
    const currentRoom = ROOM_ROUTE[activeRoomIndex]!;

    return {
      currentRoom: {
        id: currentRoom.roomId,
        label: currentRoom.label,
      },
      target:
        targetRoute && targetDoor && !targetDoor.open
          ? {
              doorId: targetDoor.id,
              roomId: targetRoute.roomId,
              label: targetRoute.label,
              position: targetDoor.position.clone(),
              distance: playerPosition.distanceTo(targetDoor.position),
              cost: targetDoor.cost,
            }
          : null,
      rooms: ROOM_ROUTE.map((room, index) => ({
        id: room.roomId,
        label: room.label,
        unlocked: index <= activeRoomIndex,
        active: index === activeRoomIndex,
      })),
    };
  }

  repairAllBarriers(): void {
    for (const buyable of this.buyables) {
      if (buyable.kind === 'barrier') buyable.boards = 5;
    }
  }

  damageBarrier(barrierId: string, amount = 1): void {
    const barrier = this.buyables.find((b) => b.id === barrierId);
    if (barrier?.kind === 'barrier' && barrier.boards !== undefined) {
      barrier.boards = Math.max(0, barrier.boards - amount);
    }
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    input: InputController,
    economy: PointsEconomy,
  ): BuyableEvent[] {
    this.interactionPrompt = '';
    const events: BuyableEvent[] = [];
    let nearest: Buyable | null = null;
    let nearestDist = Infinity;

    for (const buyable of this.buyables) {
      if (buyable.kind === 'door' && buyable.open) continue;
      if (buyable.kind === 'perk' && buyable.perkId && this.ownedPerks.has(buyable.perkId)) {
        continue;
      }
      const dist = playerPosition.distanceTo(buyable.position);
      if (dist < buyable.radius && dist < nearestDist) {
        nearest = buyable;
        nearestDist = dist;
      }
    }

    if (!nearest) {
      this.interactionProgress = Math.max(0, this.interactionProgress - delta * 2);
      return events;
    }

    if (nearest.requiresPower && !this.powerOn) {
      this.interactionPrompt = 'Power required';
      this.interactionProgress = 0;
      return events;
    }

    let cost = nearest.cost;
    let ammoOnly = false;
    if (nearest.kind === 'wall-buy' && nearest.weaponId) {
      if (this.ownedWeapons.has(nearest.weaponId)) {
        cost = nearest.ammoCost ?? Math.floor(nearest.cost / 2);
        ammoOnly = true;
        this.interactionPrompt = `Hold E // Ammo ${nearest.weaponId} — ${cost}`;
      } else {
        this.interactionPrompt = `Hold E // ${nearest.weaponId} — ${cost}`;
      }
    } else if (nearest.kind === 'barrier') {
      if ((nearest.boards ?? 0) >= 5) {
        this.interactionPrompt = '';
        this.interactionProgress = 0;
        return events;
      }
      this.interactionPrompt = `Hold E // Repair barrier — ${cost}`;
    } else if (nearest.kind === 'power-switch') {
      this.interactionPrompt = this.powerOn
        ? 'Hold E // Re-engage facility power'
        : 'Hold E // Restore facility power';
    } else {
      this.interactionPrompt = `Hold E // ${nearest.label}`;
    }

    if (!economy.canAfford(cost) && cost > 0) {
      this.interactionPrompt = `Need ${cost} points`;
      this.interactionProgress = 0;
      return events;
    }

    const holdSeconds =
      nearest.kind === 'door' || nearest.kind === 'power-switch' ? 1.2 : 0.75;
    if (input.isDown('KeyE')) {
      this.interactionProgress = Math.min(1, this.interactionProgress + delta / holdSeconds);
    } else {
      this.interactionProgress = Math.max(0, this.interactionProgress - delta * 1.8);
    }

    if (this.interactionProgress < 1) return events;
    this.interactionProgress = 0;

    if (cost > 0 && !economy.spend(cost)) return events;

    switch (nearest.kind) {
      case 'wall-buy':
        if (nearest.weaponId) {
          this.ownedWeapons.add(nearest.weaponId);
          events.push({
            type: 'wall-buy',
            weaponId: nearest.weaponId,
            cost,
            ammoOnly,
          });
        }
        break;
      case 'door':
        nearest.open = true;
        if (nearest.unlocks) {
          events.push({
            type: 'door',
            doorId: nearest.id,
            unlocks: nearest.unlocks,
            cost,
          });
        }
        break;
      case 'barrier':
        nearest.boards = Math.min(5, (nearest.boards ?? 0) + 1);
        events.push({ type: 'barrier-repair', barrierId: nearest.id, cost });
        break;
      case 'power-switch':
        if (this.powerOn) {
          events.push({ type: 'power-retrigger' });
        } else {
          this.powerOn = true;
          events.push({ type: 'power-on' });
        }
        this.interactionPrompt = 'Hold E // Re-engage facility power';
        break;
      case 'mystery-box':
        events.push({ type: 'mystery-box', cost });
        break;
      case 'perk':
        if (nearest.perkId) {
          this.ownedPerks.add(nearest.perkId);
          events.push({ type: 'perk', perkId: nearest.perkId, cost });
        }
        break;
      case 'pack-a-punch':
        events.push({ type: 'pack-a-punch', cost });
        break;
      default:
        break;
    }
    return events;
  }
}
