import {
  ATTACHMENTS,
  clampStat,
  STAT_ORDER,
  weaponById,
  WEAPONS,
  type AttachmentDef,
  type SlotType,
  type StatBlock,
  type StatKey,
} from "../data/arsenal";
import { DEFAULT_FINISH_ID, MATCH_FINISH_ID } from "../data/finishes";

export interface StatReadout {
  key: StatKey;
  base: number;
  effective: number;
  delta: number;
}

type Listener = () => void;

interface Events {
  weaponChanged: Listener[];
  loadoutChanged: Listener[];
  viewChanged: Listener[];
  finishChanged: Listener[];
}

/** Stage view modes driven by the tool bar. Sound is owned by AudioManager. */
export type ViewToggle = "lift" | "explode" | "compare";

/** Frame and modules carry independent finishes. */
export type FinishTarget = "weapon" | "attachment";

/** Single owner of selection + loadout state. */
export class AppState {
  private weaponId: string = WEAPONS[0].id;
  /** weaponId -> set of equipped attachment ids (one per slot at most). */
  private loadouts = new Map<string, Map<SlotType, string>>();
  /** weaponId -> chosen finish per target, so each frame keeps its own look. */
  private finishes = new Map<string, Record<FinishTarget, string>>();
  private events: Events = {
    weaponChanged: [],
    loadoutChanged: [],
    viewChanged: [],
    finishChanged: [],
  };
  private toggles: Record<ViewToggle, boolean> = {
    lift: false,
    explode: false,
    compare: false,
  };
  /** The slot changed by the most recent equip/unequip, for targeted feedback. */
  lastChangedSlot: SlotType | null = null;

  isOn(key: ViewToggle): boolean {
    return this.toggles[key];
  }

  setToggle(key: ViewToggle, on: boolean): void {
    if (this.toggles[key] === on) return;
    this.toggles[key] = on;
    this.emit("viewChanged");
  }

  on(event: keyof Events, fn: Listener): void {
    this.events[event].push(fn);
  }

  private emit(event: keyof Events): void {
    for (const fn of this.events[event]) fn();
  }

  get currentWeaponId(): string {
    return this.weaponId;
  }

  get currentWeapon() {
    return weaponById(this.weaponId);
  }

  selectWeapon(id: string): void {
    if (id === this.weaponId) return;
    weaponById(id);
    this.weaponId = id;
    this.emit("weaponChanged");
  }

  private finishFor(weaponId: string): Record<FinishTarget, string> {
    let finish = this.finishes.get(weaponId);
    if (!finish) {
      // Modules follow the frame until you deliberately break them out.
      finish = { weapon: DEFAULT_FINISH_ID, attachment: MATCH_FINISH_ID };
      this.finishes.set(weaponId, finish);
    }
    return finish;
  }

  finishId(target: FinishTarget): string {
    return this.finishFor(this.weaponId)[target];
  }

  setFinish(target: FinishTarget, id: string): void {
    const finish = this.finishFor(this.weaponId);
    if (finish[target] === id) return;
    finish[target] = id;
    this.emit("finishChanged");
  }

  private loadoutFor(weaponId: string): Map<SlotType, string> {
    let loadout = this.loadouts.get(weaponId);
    if (!loadout) {
      loadout = new Map();
      this.loadouts.set(weaponId, loadout);
    }
    return loadout;
  }

  equippedIn(slot: SlotType): AttachmentDef | null {
    const id = this.loadoutFor(this.weaponId).get(slot);
    return id ? ATTACHMENTS.find((a) => a.id === id) ?? null : null;
  }

  slotSupported(slot: SlotType): boolean {
    return slot in this.currentWeapon.slots;
  }

  toggleSlot(slot: SlotType, attachment: AttachmentDef): void {
    if (!this.slotSupported(slot)) return;
    const loadout = this.loadoutFor(this.weaponId);
    if (loadout.get(slot) === attachment.id) {
      loadout.delete(slot);
    } else {
      loadout.set(slot, attachment.id);
    }
    this.lastChangedSlot = slot;
    this.emit("loadoutChanged");
  }

  equippedAttachments(): AttachmentDef[] {
    const loadout = this.loadoutFor(this.weaponId);
    const result: AttachmentDef[] = [];
    for (const [slot, id] of loadout) {
      // A bay removed from the weapon data must stop contributing stats even
      // if a loadout from earlier in the session still holds it.
      if (!this.slotSupported(slot)) continue;
      const def = ATTACHMENTS.find((a) => a.id === id);
      if (def) result.push(def);
    }
    return result;
  }

  effectiveStats(): StatReadout[] {
    const base: StatBlock = this.currentWeapon.stats;
    const totals: Partial<Record<StatKey, number>> = {};
    for (const attachment of this.equippedAttachments()) {
      for (const [key, value] of Object.entries(attachment.modifiers)) {
        const stat = key as StatKey;
        totals[stat] = (totals[stat] ?? 0) + value;
      }
    }
    return STAT_ORDER.map((key) => {
      const effective = clampStat(base[key] + (totals[key] ?? 0));
      return { key, base: base[key], effective, delta: effective - base[key] };
    });
  }
}
