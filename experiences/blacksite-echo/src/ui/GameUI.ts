import {
  ATTACHMENT_SLOTS,
  deriveStats,
  deriveWeaponRuntime,
  getAttachment,
  getAttachmentsForSlot,
  getWeapon,
  OPS_LOADOUT_WEAPON_IDS,
  type AttachmentDefinition,
  type WeaponDefinition,
} from '../data/weapons';
import type {
  AppMode,
  AttachmentSelection,
  AttachmentSlot,
  Difficulty,
  GameSettings,
  MissionResult,
  ObjectiveState,
  PersistedState,
  WeaponLoadout,
  ZombiesResult,
} from '../game/types';
import type { ZombiesHudState } from '../zombies/ZombiesController';
import { POWER_UP_PRESENTATIONS, powerUpIconSvg } from '../zombies/PowerUpCatalog';
import type { CampusRoomNavigationState } from '../zombies/RoomTransitSystem';
import { PERK_LABELS, type PowerUpKind } from '../zombies/zombiesData';
import type { PlayerController } from '../player/PlayerController';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import type {
  MapsOutbreakDraft,
  MapsOutbreakDraftStatus,
} from '../maps-zombies';

export type UiActions = {
  onAction(action: string, value?: string): void;
  onSetting(path: string, value: string | number | boolean): void;
};

export type AttachmentChange = {
  weaponId: string;
  slot: AttachmentSlot;
  previousId: string;
  currentId: string;
};

export type ZombiesCombatFeedback = {
  critical: boolean;
  killed: boolean;
  points: number;
  melee?: boolean;
};

const STAT_LABELS: Record<string, string> = {
  damage: 'Damage',
  range: 'Range',
  fireRate: 'Fire rate',
  accuracy: 'Accuracy',
  mobility: 'Mobility',
  handling: 'Handling',
};

function signed(value: number, digits = 0): string {
  const rounded = value.toFixed(digits);
  return `${value > 0 ? '+' : ''}${rounded}`;
}

function attachmentModifierSummary(attachment: AttachmentDefinition): string {
  const values = Object.entries(attachment.modifiers).map(
    ([name, value]) => `${STAT_LABELS[name] ?? name} ${signed(value ?? 0)}`,
  );
  if (attachment.magazineScale) {
    values.push(`Magazine ${signed((attachment.magazineScale - 1) * 100)}%`);
  }
  if (attachment.reloadScale) {
    values.push(`Reload ${signed((attachment.reloadScale - 1) * 100)}%`);
  }
  if (attachment.suppressed) values.push('Suppressed');
  return values.join(' // ') || 'No stat change';
}

function cloneSelection(selection: AttachmentSelection): AttachmentSelection {
  return { ...selection };
}

function formatTime(milliseconds: number | null): string {
  if (milliseconds === null) return '--:--.--';
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((milliseconds % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    centiseconds,
  ).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const MAPS_GENERATING_STATUSES: ReadonlySet<MapsOutbreakDraftStatus> = new Set([
  'queued',
  'generating',
  'installing',
]);

const MAPS_PREVIOUS_STATUSES: ReadonlySet<MapsOutbreakDraftStatus> = new Set([
  'ready',
  'failed',
]);

function mapsDraftStatusLabel(status: MapsOutbreakDraftStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'generating':
      return 'Generating';
    case 'installing':
      return 'Installing';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'editing':
      return 'Draft';
    default:
      return status;
  }
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export class GameUI {
  private inspectedWeaponId = 'arx-7';
  private captionTimer = 0;
  private damageTimer = 0;
  private flashTimer = 0;
  private hitTimer = 0;
  private zombiesCombatTimer = 0;
  private zombiesPointTimer = 0;
  private zombiesRoundTimer = 0;
  private zombiesChainTimer = 0;
  private zombiesChain = 0;
  private previousZombiesPoints: number | null = null;
  private previousZombiesRound: number | null = null;
  private previousZombiesHealthState = '';
  private previousZombiesAmmoState = '';
  private previousPowerUpHudSignature = '';
  private previousPowerUpToastSequence = 0;
  private mintWeaponImages: Record<string, string> = {};
  private attachmentChange: AttachmentChange | null = null;
  private focusedAttachmentId = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    this.root.innerHTML = this.createMarkup();
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('pointerenter', this.onPointerEnter, true);
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onInput);
    this.setMode('loading');
  }

  setMode(mode: AppMode): void {
    const screens = this.root.querySelectorAll<HTMLElement>('[data-mode]');
    for (const screen of screens) {
      const modes = screen.dataset.mode?.split(' ') ?? [];
      screen.classList.toggle('hidden', !modes.includes(mode));
    }
    if (mode !== 'loading') {
      this.root
        .querySelector<HTMLElement>('.loading-screen')
        ?.setAttribute('aria-busy', 'false');
    }
    if (
      mode === 'zombies' ||
      mode === 'maps-zombies' ||
      mode === 'maps-zombies-create'
    ) {
      this.previousZombiesPoints = null;
      this.previousZombiesRound = null;
      this.previousZombiesHealthState = '';
      this.previousZombiesAmmoState = '';
      this.zombiesChain = 0;
      this.zombiesChainTimer = 0;
    }
    // Campus room navigator is meaningless for single-room Maps Outbreak.
    const roomNavigator = this.root.querySelector<HTMLElement>(
      '#zombies-room-navigator',
    );
    const roomWaypoint = this.root.querySelector<HTMLElement>(
      '#zombies-room-waypoint',
    );
    if (roomNavigator) {
      roomNavigator.classList.toggle('hidden', mode === 'maps-zombies');
    }
    if (roomWaypoint && mode === 'maps-zombies') {
      roomWaypoint.classList.add('hidden');
    }
  }

  getMapsOutbreakForm(): { mapsUrl: string; title: string } {
    const mapsUrl =
      this.root.querySelector<HTMLTextAreaElement>('#maps-outbreak-url')
        ?.value ?? '';
    const title =
      this.root.querySelector<HTMLInputElement>('#maps-outbreak-title')
        ?.value ?? '';
    return { mapsUrl, title };
  }

  setMapsOutbreakForm(form: { mapsUrl: string; title: string }): void {
    const urlField = this.root.querySelector<HTMLTextAreaElement>(
      '#maps-outbreak-url',
    );
    const titleField = this.root.querySelector<HTMLInputElement>(
      '#maps-outbreak-title',
    );
    if (urlField) urlField.value = form.mapsUrl;
    if (titleField) titleField.value = form.title;
  }

  setMapsOutbreakStatus(message: string, deployEnabled = false): void {
    const status = this.root.querySelector<HTMLElement>('#maps-outbreak-status');
    if (status) status.textContent = message;
    const deploy = this.root.querySelector<HTMLButtonElement>(
      '#maps-outbreak-deploy',
    );
    if (deploy) deploy.disabled = !deployEnabled;
  }

  renderMapsFeaturedArenas(
    entries: Array<{
      id: string;
      title: string;
      blurb: string;
      thumbnailUrl?: string;
    }>,
    warmingKeys: ReadonlySet<string> | string[] = [],
  ): void {
    const host = this.root.querySelector<HTMLElement>('#maps-featured-list');
    if (!host) return;
    const warming = warmingKeys instanceof Set
      ? warmingKeys
      : new Set(warmingKeys);
    if (entries.length === 0) {
      host.innerHTML =
        '<p class="muted maps-featured-empty">No featured arenas shipped yet.</p>';
      return;
    }
    host.innerHTML = entries
      .map((entry) => {
        const warmKey = `featured:${entry.id}`;
        const isWarming = warming.has(warmKey);
        const thumb = entry.thumbnailUrl
          ? `<img class="maps-featured-thumb" src="${escapeHtml(entry.thumbnailUrl)}" alt="" loading="lazy" />`
          : '<div class="maps-featured-thumb maps-featured-thumb-fallback" aria-hidden="true"></div>';
        return `<button type="button" class="maps-featured-card${isWarming ? ' is-warming' : ''}" data-action="maps-zombies-play-featured" data-prefetch="maps-zombies-prefetch-featured" data-value="${escapeHtml(entry.id)}">
          ${thumb}
          <span class="maps-featured-copy">
            <strong>${escapeHtml(entry.title)}</strong>
            <span class="muted">${escapeHtml(entry.blurb)}</span>
            <span class="maps-featured-play">${isWarming ? 'Warming…' : 'Play'}</span>
          </span>
        </button>`;
      })
      .join('');
  }

  renderMapsOutbreakDrafts(
    drafts: MapsOutbreakDraft[],
    activeId: string | null,
    warmingKeys: ReadonlySet<string> | string[] = [],
  ): void {
    const generatingHost = this.root.querySelector<HTMLElement>(
      '#maps-generating-list',
    );
    const previousHost = this.root.querySelector<HTMLElement>(
      '#maps-previous-list',
    );
    if (!generatingHost || !previousHost) return;
    const warming = warmingKeys instanceof Set
      ? warmingKeys
      : new Set(warmingKeys);

    const generating = drafts.filter((draft) =>
      MAPS_GENERATING_STATUSES.has(draft.status),
    );
    const previous = drafts.filter((draft) =>
      MAPS_PREVIOUS_STATUSES.has(draft.status),
    );

    generatingHost.innerHTML =
      generating.length === 0
        ? '<p class="muted maps-drafts-empty">No arenas generating.</p>'
        : generating
            .map((draft) => this.renderMapsDraftCard(draft, activeId, warming))
            .join('');

    previousHost.innerHTML =
      previous.length === 0
        ? '<p class="muted maps-drafts-empty">No private drafts yet.</p>'
        : previous
            .map((draft) => this.renderMapsDraftCard(draft, activeId, warming))
            .join('');
  }

  private renderMapsDraftCard(
    draft: MapsOutbreakDraft,
    activeId: string | null,
    warming: ReadonlySet<string>,
  ): string {
    const warmKey = `draft:${draft.id}`;
    const isWarming = warming.has(warmKey);
    const thumb = draft.pose.thumbnailUrl
      ? `<img class="maps-draft-thumb" src="${escapeHtml(draft.pose.thumbnailUrl)}" alt="" loading="lazy" />`
      : '<div class="maps-draft-thumb maps-featured-thumb-fallback" aria-hidden="true"></div>';
    const activeClass = draft.id === activeId ? ' is-active' : '';
    const warmingClass = isWarming ? ' is-warming' : '';
    const inFlight = MAPS_GENERATING_STATUSES.has(draft.status);
    const detail =
      (draft.status === 'failed' || inFlight) && draft.error
        ? escapeHtml(draft.error)
        : isWarming
          ? 'Warming splat cache…'
          : escapeHtml(formatRelativeTime(draft.updatedAt));
    const actionHint =
      draft.status === 'ready'
        ? `<span class="maps-draft-open">${isWarming ? 'Warming…' : 'Open'}</span>`
        : '';
    return `<button type="button" class="maps-draft-card${activeClass}${warmingClass}" data-action="maps-zombies-select-draft" data-prefetch="maps-zombies-prefetch-draft" data-value="${escapeHtml(draft.id)}">
      ${thumb}
      <span class="maps-draft-copy">
        <strong>${escapeHtml(draft.title)}</strong>
        <span class="maps-draft-meta">
          <span class="maps-draft-status maps-draft-status-${escapeHtml(draft.status)}">${escapeHtml(mapsDraftStatusLabel(draft.status))}</span>
          <span class="muted maps-draft-detail">${detail}</span>
        </span>
        ${actionHint}
      </span>
    </button>`;
  }

  updateLoading(progress: number, label: string): void {
    const normalized = Math.max(0, Math.min(1, progress));
    const screen = this.getElement('.loading-screen');
    screen.setAttribute('aria-busy', 'true');
    screen.classList.remove('loading-failed');
    this.getElement('.loading-progress').style.width = `${Math.round(normalized * 100)}%`;
    this.getElement('#loading-percent').textContent = `${Math.round(normalized * 100)}%`;
    this.getElement('#loading-label').textContent = label;
    this.getElement('#loading-error').textContent = '';
    this.getElement('#loading-error').classList.add('hidden');
    this.getElement('#loading-retry').classList.add('hidden');
  }

  showLoadingError(message: string): void {
    const screen = this.getElement('.loading-screen');
    screen.setAttribute('aria-busy', 'false');
    screen.classList.add('loading-failed');
    this.getElement('#loading-label').textContent = 'Containment stream interrupted';
    this.getElement('#loading-error').textContent = message;
    this.getElement('#loading-error').classList.remove('hidden');
    this.getElement('#loading-retry').classList.remove('hidden');
  }

  applyMintImages(images: {
    keyArt?: string | null;
    tacticalMap?: string | null;
    briefing?: string | null;
    insignia?: string | null;
    loading?: string | null;
    signage?: string | null;
    weaponThumbnails?: Record<string, string | null>;
  }): void {
    const variables: Array<[string, string | null | undefined]> = [
      ['--mint-key-art', images.keyArt],
      ['--mint-tactical-map', images.tacticalMap],
      ['--mint-briefing-art', images.briefing],
      ['--mint-insignia', images.insignia],
      ['--mint-loading-art', images.loading],
      ['--mint-signage', images.signage],
    ];
    for (const [name, value] of variables) {
      if (value) this.root.style.setProperty(name, `url("${value}")`);
    }
    this.mintWeaponImages = Object.fromEntries(
      Object.entries(images.weaponThumbnails ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  renderOperations(state: PersistedState): void {
    this.getElement('#ops-best-time').textContent = formatTime(state.progress.bestTimeMs);
    this.getElement('#ops-completion').textContent = state.progress.completed
      ? 'MISSION CLEARED'
      : 'NOT DEPLOYED';
    this.getElement('#ops-loadout-summary').textContent =
      `${getWeapon(state.loadout.primaryId).shortName} / Aegis P11`;
    const zombiesBest = this.root.querySelector('#ops-zombies-best');
    if (zombiesBest) {
      zombiesBest.textContent =
        state.progress.zombiesBestRound > 0
          ? `R${state.progress.zombiesBestRound}`
          : '--';
    }
  }

  setInspectedWeapon(id: string, loadout: WeaponLoadout): WeaponDefinition {
    this.inspectedWeaponId = id;
    this.attachmentChange = null;
    this.focusedAttachmentId = loadout.attachments[id]?.optic ?? '';
    this.renderLoadout(loadout);
    return getWeapon(id);
  }

  setAttachmentChange(change: AttachmentChange): void {
    this.attachmentChange = change;
    this.focusedAttachmentId = change.currentId;
  }

  getArmoryViewport(): HTMLElement {
    return this.getElement('#weapon-preview-viewport');
  }

  renderLoadout(loadout: WeaponLoadout): void {
    const weapon = getWeapon(this.inspectedWeaponId);
    const selection = loadout.attachments[weapon.id];
    if (!selection) return;
    const baseStats = weapon.stats;
    const stats = deriveStats(weapon, selection);
    const previousSelection = cloneSelection(selection);
    const activeChange =
      this.attachmentChange?.weaponId === weapon.id ? this.attachmentChange : null;
    if (activeChange) previousSelection[activeChange.slot] = activeChange.previousId;
    const previousStats = deriveStats(weapon, previousSelection);
    const runtime = deriveWeaponRuntime(weapon, selection);
    const previousRuntime = deriveWeaponRuntime(weapon, previousSelection);
    const list = this.getElement('#weapon-list');
    const armoryWeapons = OPS_LOADOUT_WEAPON_IDS.map((id) => getWeapon(id));
    list.innerHTML = armoryWeapons
      .map((item, index) => {
        const selected = item.id === this.inspectedWeaponId ? 'selected' : '';
        const equipped =
          item.id === loadout.primaryId || item.id === loadout.sidearmId
            ? 'EQUIPPED'
            : item.className;
        const thumbnail = this.mintWeaponImages[item.id];
        return `
        <button class="weapon-option ${selected}" data-action="select-weapon" data-value="${item.id}">
          <span class="weapon-index">${String(index + 1).padStart(2, '0')}</span>
          ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="eager">` : ''}
          <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(equipped)}</small></span>
          <span class="weapon-type">${item.id === 'aegis-p11' ? 'SIDEARM' : 'PRIMARY'}</span>
        </button>
      `;
      })
      .join('');
    this.getElement('#weapon-name').textContent = weapon.name;
    this.getElement('#weapon-class').textContent = weapon.className;
    this.getElement('#weapon-description').textContent = weapon.description;
    const statsRoot = this.getElement('#weapon-stats');
    statsRoot.innerHTML = Object.entries(stats)
      .map(
        ([name, value]) => {
          const key = name as keyof typeof stats;
          const change = value - previousStats[key];
          const total = value - baseStats[key];
          return `
        <div class="stat-row" data-stat="${name}">
          <span>${STAT_LABELS[name] ?? name}</span>
          <span class="stat-track">
            <span class="stat-base-marker" style="left:${baseStats[key]}%" title="Base ${Math.round(baseStats[key])}"></span>
            <span class="stat-fill" style="width:${value}%"></span>
          </span>
          <strong>${Math.round(value)}</strong>
          <em class="${change > 0 ? 'positive' : change < 0 ? 'negative' : ''}">
            ${change === 0 ? (total === 0 ? 'BASE' : `${signed(total)} total`) : `${Math.round(previousStats[key])}→${Math.round(value)} (${signed(change)})`}
          </em>
        </div>`;
        },
      )
      .join('');
    this.getElement('#weapon-quantities').innerHTML = this.renderQuantities(
      runtime,
      previousRuntime,
      Boolean(activeChange),
    );

    const attachmentRoot = this.getElement('#attachment-groups');
    attachmentRoot.innerHTML = ATTACHMENT_SLOTS.map((slot) => {
      const options = getAttachmentsForSlot(slot);
      return `
        <section class="attachment-group">
          <h3>${slot}</h3>
          <div class="chip-row">
            ${options
              .map(
                (attachment) => `
              <button class="chip ${selection[slot] === attachment.id ? 'selected' : ''}"
                data-action="select-attachment"
                data-value="${slot}:${attachment.id}"
                title="${escapeHtml(attachmentModifierSummary(attachment))}">
                <span>${escapeHtml(attachment.name)}</span>
                <small>${escapeHtml(attachmentModifierSummary(attachment))}</small>
              </button>`,
              )
              .join('')}
          </div>
        </section>`;
    }).join('');
    const focused =
      getAttachment(this.focusedAttachmentId || activeChange?.currentId || selection.optic);
    const previousFocused = activeChange
      ? getAttachment(activeChange.previousId)
      : null;
    const statChanges = Object.entries(stats)
      .filter(([name]) => {
        const key = name as keyof typeof stats;
        return stats[key] !== previousStats[key];
      })
      .map(([name]) => {
        const key = name as keyof typeof stats;
        const delta = stats[key] - previousStats[key];
        return `<li class="${delta > 0 ? 'positive' : 'negative'}">${STAT_LABELS[name] ?? name} ${Math.round(previousStats[key])}→${Math.round(stats[key])} (${signed(delta)})</li>`;
      })
      .join('');
    this.getElement('#tradeoff-copy').innerHTML = `
      <div class="tradeoff-heading">
        <strong>${escapeHtml(focused.name)}</strong>
        <span>1× installed</span>
      </div>
      <p>${escapeHtml(focused.description)}</p>
      ${
        previousFocused && previousFocused.id !== focused.id
          ? `<p class="comparison-label">Changed from ${escapeHtml(previousFocused.name)}</p>`
          : ''
      }
      <ul>${statChanges || `<li>${escapeHtml(attachmentModifierSummary(focused))}</li>`}</ul>
    `;

    const isSidearm = weapon.id === 'aegis-p11';
    const equipButton = this.getElement<HTMLButtonElement>('#equip-primary');
    equipButton.disabled = isSidearm;
    equipButton.classList.toggle('hidden', isSidearm);
    equipButton.textContent =
      weapon.id === loadout.primaryId ? 'Primary equipped' : `Equip ${weapon.shortName}`;
    this.getElement('#equipment-smoke').classList.toggle(
      'selected',
      loadout.equipmentId === 'murk-smoke',
    );
    this.getElement('#equipment-disruptor').classList.toggle(
      'selected',
      loadout.equipmentId === 'volt-disruptor',
    );
  }

  private renderQuantities(
    runtime: WeaponDefinition,
    previous: WeaponDefinition,
    showChanges: boolean,
  ): string {
    const format = (
      label: string,
      value: string | number,
      previousValue: string | number,
      suffix = '',
      inverse = false,
    ): string => {
      const numeric = typeof value === 'number' && typeof previousValue === 'number';
      const delta = numeric ? value - previousValue : 0;
      const changed = showChanges && value !== previousValue;
      const direction = inverse ? -Math.sign(delta) : Math.sign(delta);
      return `
        <div class="quantity-card ${changed ? (direction >= 0 ? 'positive' : 'negative') : ''}">
          <span>${label}</span>
          <strong>${value}${suffix}</strong>
          <small>${changed ? `${previousValue}${suffix} → ${value}${suffix}` : 'Current loadout'}</small>
        </div>`;
    };
    const damageLabel = runtime.pellets > 1 ? `${runtime.pellets} × ${runtime.damage.toFixed(1)}` : runtime.damage.toFixed(1);
    const previousDamage =
      previous.pellets > 1
        ? `${previous.pellets} × ${previous.damage.toFixed(1)}`
        : previous.damage.toFixed(1);
    return [
      format('Magazine', runtime.magazineSize, previous.magazineSize, ' rds'),
      format('Reserve', runtime.reserve, previous.reserve, ' rds'),
      format('Damage / shot', damageLabel, previousDamage),
      format('Fire rate', runtime.roundsPerMinute, previous.roundsPerMinute, ' rpm'),
      format(
        'Reload',
        Number(runtime.reloadSeconds.toFixed(2)),
        Number(previous.reloadSeconds.toFixed(2)),
        ' s',
        true,
      ),
      format(
        'Falloff end',
        Number(runtime.falloffEnd.toFixed(1)),
        Number(previous.falloffEnd.toFixed(1)),
        ' m',
      ),
      format(
        'Recoil',
        Number((runtime.recoil * 1000).toFixed(1)),
        Number((previous.recoil * 1000).toFixed(1)),
        '',
        true,
      ),
      format(
        'Spread',
        Number((runtime.spread * 57.2958).toFixed(2)),
        Number((previous.spread * 57.2958).toFixed(2)),
        '°',
        true,
      ),
      format('Suppressed', runtime.suppressed ? 'YES' : 'NO', previous.suppressed ? 'YES' : 'NO'),
      format('Tactical', 2, 2, ' charges'),
    ].join('');
  }

  renderSettings(settings: GameSettings): void {
    const values: Record<string, string | number | boolean> = {
      sensitivity: settings.accessibility.sensitivity,
      fov: settings.accessibility.fov,
      aimMode: settings.accessibility.aimMode,
      crouchMode: settings.accessibility.crouchMode,
      sprintMode: settings.accessibility.sprintMode,
      subtitles: settings.accessibility.subtitles,
      combatCaptions: settings.accessibility.combatCaptions,
      reducedShake: settings.accessibility.reducedShake,
      reducedFlashing: settings.accessibility.reducedFlashing,
      motionBlur: settings.accessibility.motionBlur,
      highContrastReticle: settings.accessibility.highContrastReticle,
      quality: settings.quality,
      master: settings.audio.master,
      effects: settings.audio.effects,
      ambience: settings.audio.ambience,
      dialogue: settings.audio.dialogue,
      interface: settings.audio.interface,
    };
    for (const [name, value] of Object.entries(values)) {
      const element = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-setting="${name}"]`,
      );
      if (!element) continue;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        element.checked = Boolean(value);
      } else {
        element.value = String(value);
      }
    }
  }

  renderDifficulty(difficulty: Difficulty): void {
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-difficulty]')) {
      button.classList.toggle('selected', button.dataset.difficulty === difficulty);
    }
  }

  updateHud(
    delta: number,
    objective: ObjectiveState,
    player: PlayerController,
    weapon: WeaponSystem,
    equipmentLabel: string,
    equipmentCount: number,
    spawnProtectionRemaining: number,
    spawnProtectionAwaitingControl: boolean,
    tactical?: {
      objective: { x: number; y: number; z: number };
      bounds: { min: { x: number; z: number }; max: { x: number; z: number } } | null;
    },
  ): void {
    this.getElement('#hud-objective-name').textContent = objective.label;
    this.getElement('#hud-objective-detail').textContent = objective.detail;
    this.getElement('.objective-progress span').style.width = `${objective.progress * 100}%`;
    this.getElement('#hud-health').textContent = String(Math.ceil(player.health));
    this.getElement('#hud-armor').textContent = String(Math.ceil(player.armor));
    this.getElement('#health-fill').style.width = `${player.health}%`;
    this.getElement('#armor-fill').style.width = `${player.armor}%`;
    this.getElement('#hud-weapon-name').textContent = weapon.current.name;
    this.getElement('#hud-magazine').textContent = String(weapon.ammoState.magazine).padStart(2, '0');
    this.getElement('#hud-reserve').textContent = String(weapon.ammoState.reserve).padStart(3, '0');
    this.updateWeaponSlots('hud', weapon);
    this.getElement('#hud-equipment-name').textContent = equipmentLabel;
    this.getElement('#hud-equipment-count').textContent = `×${equipmentCount}`;
    const spawnProtection = this.getElement('#spawn-protection');
    const spawnProtectionActive = spawnProtectionRemaining > 0;
    spawnProtection.classList.toggle('hidden', !spawnProtectionActive);
    this.getElement('#spawn-protection-status').textContent =
      spawnProtectionAwaitingControl
        ? 'Awaiting control'
        : `${Math.max(1, Math.ceil(spawnProtectionRemaining))}s`;
    this.getElement('#interaction-prompt').textContent =
      this.getElement('#interaction-prompt').textContent;
    const suppression = this.getElement('#suppression-overlay');
    suppression.style.opacity = String(player.suppression * 0.75);
    this.getElement('.reticle').style.opacity = weapon.adsFactor > 0.78 ? '0' : '1';
    if (tactical) this.updateTacticalMap(player, tactical.objective, tactical.bounds);

    this.captionTimer -= delta;
    this.damageTimer -= delta;
    this.flashTimer -= delta;
    this.hitTimer -= delta;
    if (this.captionTimer <= 0) this.getElement('#combat-caption').classList.add('hidden');
    this.getElement('#damage-overlay').style.opacity = this.damageTimer > 0 ? '1' : '0';
    this.getElement('#flash-overlay').style.opacity = this.flashTimer > 0 ? '0.72' : '0';
    if (this.hitTimer <= 0) this.getElement('#hit-marker').classList.remove('active');
  }

  private updateTacticalMap(
    player: PlayerController,
    objective: { x: number; y: number; z: number },
    bounds: { min: { x: number; z: number }; max: { x: number; z: number } } | null,
  ): void {
    const map = this.getElement('#hud-tactical-map');
    const playerMarker = this.getElement('#hud-map-player');
    const objectiveMarker = this.getElement('#hud-map-objective');
    const edgeArrow = this.getElement('#hud-map-edge-arrow');
    if (!bounds) {
      map.classList.add('hidden');
      return;
    }
    map.classList.remove('hidden');
    const width = Math.max(1, bounds.max.x - bounds.min.x);
    const depth = Math.max(1, bounds.max.z - bounds.min.z);
    const toMap = (x: number, z: number): { left: number; top: number; clamped: boolean } => {
      const rawLeft = ((x - bounds.min.x) / width) * 100;
      const rawTop = ((z - bounds.min.z) / depth) * 100;
      const left = Math.min(96, Math.max(4, rawLeft));
      const top = Math.min(96, Math.max(4, rawTop));
      return {
        left,
        top,
        clamped: rawLeft < 4 || rawLeft > 96 || rawTop < 4 || rawTop > 96,
      };
    };

    const playerMap = toMap(player.position.x, player.position.z);
    playerMarker.style.left = `${playerMap.left}%`;
    playerMarker.style.top = `${playerMap.top}%`;
    const headingDeg = (-player.yaw * 180) / Math.PI;
    playerMarker.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`;

    const objectiveMap = toMap(objective.x, objective.z);
    objectiveMarker.style.left = `${objectiveMap.left}%`;
    objectiveMarker.style.top = `${objectiveMap.top}%`;
    objectiveMarker.classList.toggle('off-map', objectiveMap.clamped);
    edgeArrow.classList.toggle('hidden', !objectiveMap.clamped);
    if (objectiveMap.clamped) {
      const bearing = Math.atan2(
        objective.x - player.position.x,
        objective.z - player.position.z,
      );
      edgeArrow.style.left = `${objectiveMap.left}%`;
      edgeArrow.style.top = `${objectiveMap.top}%`;
      edgeArrow.style.transform = `translate(-50%, -50%) rotate(${(bearing * 180) / Math.PI}deg)`;
    }

    const dx = objective.x - player.position.x;
    const dz = objective.z - player.position.z;
    const dy = objective.y - player.position.y;
    const distance = Math.hypot(dx, dz);
    const relativeBearing = Math.atan2(dx, dz) - player.yaw;
    const bearingDeg = Math.round(
      (((relativeBearing * 180) / Math.PI + 540) % 360) - 180,
    );
    this.getElement('#hud-map-distance').textContent = `${Math.round(distance)} m`;
    this.getElement('#hud-map-bearing').textContent =
      `${bearingDeg >= 0 ? '+' : ''}${bearingDeg}°`;
    const elevation =
      Math.abs(dy) < 0.65 ? 'level' : dy > 0 ? `+${dy.toFixed(1)} m` : `${dy.toFixed(1)} m`;
    this.getElement('#hud-map-elevation').textContent = elevation;
  }

  setInteractionPrompt(prompt: string): void {
    const nodes = this.root.querySelectorAll<HTMLElement>(
      '#interaction-prompt, #zombies-interaction-prompt',
    );
    for (const el of nodes) {
      el.textContent = prompt;
      el.classList.toggle('hidden', !prompt);
    }
  }

  updateZombiesHud(
    delta: number,
    player: PlayerController,
    weapon: WeaponSystem,
    hud: ZombiesHudState,
    roomNavigation: CampusRoomNavigationState,
    meleeReady: boolean,
  ): void {
    this.captionTimer = Math.max(0, this.captionTimer - delta);
    this.hitTimer = Math.max(0, this.hitTimer - delta);
    this.zombiesCombatTimer = Math.max(0, this.zombiesCombatTimer - delta);
    this.zombiesPointTimer = Math.max(0, this.zombiesPointTimer - delta);
    this.zombiesRoundTimer = Math.max(0, this.zombiesRoundTimer - delta);
    this.zombiesChainTimer = Math.max(0, this.zombiesChainTimer - delta);
    this.damageTimer = Math.max(0, this.damageTimer - delta);
    if (this.zombiesChainTimer <= 0) this.zombiesChain = 0;

    const hudRoot = this.getElement('.zombies-hud');
    const round = this.getElement('#zombies-round');
    round.textContent = String(hud.round);
    if (this.previousZombiesRound !== hud.round) {
      this.showZombiesRoundTransition(hud.round, this.previousZombiesRound !== null);
      this.previousZombiesRound = hud.round;
    }

    const points = this.getElement('#zombies-points');
    points.textContent = hud.points.toLocaleString('en-US');
    if (this.previousZombiesPoints !== null && this.previousZombiesPoints !== hud.points) {
      this.showZombiesPointDelta(hud.points - this.previousZombiesPoints);
    }
    this.previousZombiesPoints = hud.points;
    const powerUpBanner = this.getElement('#zombies-banner');
    const powerUpSignature = hud.powerUps.active
      .map((effect) => `${effect.kind}:${Math.max(0, Math.ceil(effect.remaining))}`)
      .join('|');
    if (powerUpSignature !== this.previousPowerUpHudSignature) {
      powerUpBanner.innerHTML = hud.powerUps.active
        .map((effect) => {
          const spec = POWER_UP_PRESENTATIONS[effect.kind];
          return `<span class="powerup-chip" data-powerup-kind="${effect.kind}" title="${spec.label}">
            <span class="powerup-icon" aria-hidden="true">${powerUpIconSvg(effect.kind)}</span>
            <b>${spec.shortLabel}</b>
            <em>${Math.max(0, Math.ceil(effect.remaining))}s</em>
          </span>`;
        })
        .join('');
      powerUpBanner.setAttribute(
        'aria-label',
        hud.powerUps.active.length
          ? hud.powerUps.active
              .map(
                (effect) =>
                  `${POWER_UP_PRESENTATIONS[effect.kind].label}, ${Math.max(
                    0,
                    Math.ceil(effect.remaining),
                  )} seconds`,
              )
              .join('. ')
          : '',
      );
      this.previousPowerUpHudSignature = powerUpSignature;
    }
    hudRoot.classList.toggle(
      'has-power-up',
      hud.powerUps.active.length > 0 || Boolean(hud.powerUps.toast),
    );

    const powerUpToast = this.getElement('#zombies-powerup-toast');
    const toast = hud.powerUps.toast;
    powerUpToast.classList.toggle('hidden', !toast);
    if (toast) {
      powerUpToast.setAttribute('data-powerup-kind', toast.kind);
    } else {
      powerUpToast.removeAttribute('data-powerup-kind');
    }
    if (toast && toast.sequence !== this.previousPowerUpToastSequence) {
      const toastKind = toast.kind as PowerUpKind;
      this.getElement('#zombies-powerup-toast-icon').innerHTML =
        powerUpIconSvg(toastKind);
      this.getElement('#zombies-powerup-toast-label').textContent = toast.label;
      this.getElement('#zombies-powerup-toast-copy').textContent =
        toast.description;
      powerUpToast.classList.remove('is-entering');
      void powerUpToast.offsetWidth;
      powerUpToast.classList.add('is-entering');
      this.previousPowerUpToastSequence = toast.sequence;
    }

    const health = Math.max(0, Math.round(player.health));
    const armor = Math.max(0, Math.round(player.armor));
    this.getElement('#zombies-health').textContent = String(health);
    this.getElement('#zombies-armor').textContent = String(armor);
    const maxHp = hud.perks.includes('juggernog') ? 250 : 100;
    const healthPercent = Math.max(0, Math.min(100, (player.health / maxHp) * 100));
    const armorPercent = Math.max(0, Math.min(100, (player.armor / 60) * 100));
    const healthFill = this.getElement('#zombies-health-fill');
    const armorFill = this.getElement('#zombies-armor-fill');
    healthFill.style.width = `${healthPercent}%`;
    armorFill.style.width = `${armorPercent}%`;
    healthFill.parentElement?.setAttribute('aria-valuenow', String(health));
    healthFill.parentElement?.setAttribute('aria-valuemax', String(maxHp));
    armorFill.parentElement?.setAttribute('aria-valuenow', String(armor));
    const healthState = hud.lastStand
      ? 'last-stand'
      : healthPercent <= 18
        ? 'critical'
        : healthPercent <= 35
          ? 'low'
          : 'stable';
    hudRoot.dataset.healthState = healthState;
    hudRoot.classList.toggle('is-low-health', healthState === 'low');
    hudRoot.classList.toggle(
      'is-critical-health',
      healthState === 'critical' || healthState === 'last-stand',
    );
    if (healthState !== this.previousZombiesHealthState) {
      const healthStatus = this.getElement('#zombies-health-status');
      healthStatus.textContent =
        healthState === 'last-stand'
          ? 'Last stand. Self-revive window active.'
          : healthState === 'critical'
            ? 'Critical health.'
            : healthState === 'low'
              ? 'Low health.'
              : '';
      this.previousZombiesHealthState = healthState;
    }

    this.getElement('#zombies-weapon-name').textContent = weapon.current.name;
    this.updateWeaponSlots('zombies', weapon);
    const magazineDigits = Math.max(2, String(weapon.current.magazineSize).length);
    this.getElement('#zombies-magazine').textContent =
      String(weapon.ammoState.magazine).padStart(magazineDigits, '0');
    this.getElement('#zombies-reserve').textContent =
      String(weapon.ammoState.reserve).padStart(3, '0');
    const lowAmmoThreshold = Math.max(2, Math.ceil(weapon.current.magazineSize * 0.25));
    const ammoState =
      weapon.state === 'reloading'
        ? 'reloading'
        : weapon.ammoState.magazine <= 0
          ? weapon.ammoState.reserve <= 0
            ? 'empty'
            : 'reload'
          : weapon.ammoState.magazine <= lowAmmoThreshold
            ? 'low'
            : 'ready';
    const weaponHud = this.getElement('.zombies-hud .hud-weapon');
    weaponHud.dataset.ammoState = ammoState;
    weaponHud.classList.toggle('is-low-ammo', ammoState === 'low');
    weaponHud.classList.toggle('is-empty-ammo', ammoState === 'reload' || ammoState === 'empty');
    weaponHud.classList.toggle('is-reloading', ammoState === 'reloading');
    const ammoStatus = this.getElement('#zombies-ammo-status');
    ammoStatus.textContent =
      ammoState === 'reloading'
        ? `Reloading ${Math.round(weapon.reloadProgress * 100)}%`
        : ammoState === 'reload'
          ? 'Reload [R]'
          : ammoState === 'empty'
            ? 'Out of ammunition'
            : ammoState === 'low'
              ? 'Low ammo'
              : '';
    if (ammoState !== this.previousZombiesAmmoState) {
      ammoStatus.setAttribute('aria-live', ammoState === 'ready' ? 'off' : 'polite');
      this.previousZombiesAmmoState = ammoState;
    }
    this.getElement('#zombies-reload-fill').style.width =
      `${weapon.state === 'reloading' ? Math.round(weapon.reloadProgress * 100) : 0}%`;

    const perks = this.getElement('#zombies-perks');
    perks.innerHTML = hud.perks
      .map((id) => `<span class="perk-chip perk-${id}">${escapeHtml(PERK_LABELS[id])}</span>`)
      .join('');
    const lastStand = this.getElement('#zombies-last-stand');
    lastStand.classList.toggle('hidden', !hud.lastStand);
    const lastStandPercent = Math.round(Math.max(0, Math.min(1, hud.lastStandProgress)) * 100);
    lastStand.style.setProperty('--last-stand-progress', `${lastStandPercent}%`);
    this.getElement('#zombies-last-stand-progress').textContent =
      `${lastStandPercent}%`;
    if (hud.prompt) {
      const prompt = this.getElement('#zombies-interaction-prompt');
      prompt.style.setProperty('--hold-progress', `${Math.round(hud.progress * 100)}%`);
    }
    this.updateZombiesRoomNavigation(player, roomNavigation);
    const meleePrompt = this.getElement('#zombies-melee-prompt');
    meleePrompt.classList.toggle('is-ready', meleeReady);
    this.getElement('#zombies-melee-action').textContent =
      meleeReady ? 'Melee now' : 'Melee';

    this.getElement('#zombies-combat-confirmation').classList.toggle(
      'hidden',
      this.zombiesCombatTimer <= 0,
    );
    this.getElement('#zombies-points-delta').classList.toggle(
      'hidden',
      this.zombiesPointTimer <= 0,
    );
    this.getElement('#zombies-round-transition').classList.toggle(
      'hidden',
      this.zombiesRoundTimer <= 0,
    );
    const roundTransitionActive = this.zombiesRoundTimer > 0;
    this.getElement('#zombies-room-navigator').classList.toggle(
      'is-suppressed',
      roundTransitionActive,
    );
    this.getElement('#zombies-room-waypoint').classList.toggle(
      'is-suppressed',
      roundTransitionActive,
    );
    this.getElement('#zombies-combo').classList.toggle(
      'hidden',
      this.zombiesChainTimer <= 0 || this.zombiesChain < 2,
    );
    this.getElement('#zombies-combat-caption').classList.toggle(
      'hidden',
      this.captionTimer <= 0,
    );
    this.getElement('#zombies-hit-marker').classList.toggle('active', this.hitTimer > 0);
    this.getElement('#zombies-damage-overlay').style.opacity =
      this.damageTimer > 0 ? '1' : '0';
  }

  beginZombiesDownedPresentation(): void {
    const overlay = this.getElement('#zombies-downed-presentation');
    overlay.classList.remove('hidden');
    overlay.style.setProperty('--downed-progress', '0');
    this.getElement('#zombies-downed-status').textContent = 'DOWNED';
  }

  updateZombiesDownedPresentation(progress: number): void {
    const normalized = Math.max(0, Math.min(1, progress));
    const overlay = this.getElement('#zombies-downed-presentation');
    overlay.style.setProperty('--downed-progress', normalized.toFixed(3));
    this.getElement('#zombies-downed-status').textContent =
      normalized < 0.72 ? 'DOWNED' : 'CONTAINMENT LOST';
  }

  endZombiesDownedPresentation(): void {
    this.getElement('#zombies-downed-presentation').classList.add('hidden');
  }

  private updateWeaponSlots(
    scope: 'hud' | 'zombies',
    weapon: WeaponSystem,
  ): void {
    const slots = new Map(weapon.slots.map((slot) => [slot.slot, slot]));
    for (const index of [0, 1] as const) {
      const slot = slots.get(index);
      const root = this.getElement(`#${scope}-weapon-slot-${index}`);
      root.classList.toggle('is-empty', !slot);
      const thumb = root.querySelector<HTMLImageElement>(
        '.weapon-slot-thumb',
      );
      if (!slot) {
        root.classList.remove('is-active');
        root.setAttribute('aria-current', 'false');
        this.getElement(`#${scope}-weapon-slot-${index}-name`).textContent =
          scope === 'zombies' ? 'Buy second gun' : 'Empty';
        this.getElement(`#${scope}-weapon-slot-${index}-ammo`).textContent =
          scope === 'zombies' ? 'Wall buy' : '—';
        if (thumb) {
          thumb.removeAttribute('src');
          thumb.alt = '';
          thumb.hidden = true;
        }
        continue;
      }
      root.classList.toggle('is-active', slot.active);
      root.setAttribute('aria-current', slot.active ? 'true' : 'false');
      this.getElement(`#${scope}-weapon-slot-${index}-name`).textContent =
        slot.weapon.shortName;
      this.getElement(`#${scope}-weapon-slot-${index}-ammo`).textContent =
        `${slot.ammo.magazine}/${slot.ammo.reserve}`;
      const imageUrl = this.mintWeaponImages[slot.weapon.id];
      if (thumb) {
        if (imageUrl) {
          if (thumb.getAttribute('src') !== imageUrl) {
            thumb.src = imageUrl;
          }
          thumb.alt = slot.weapon.shortName;
          thumb.hidden = false;
        } else {
          thumb.removeAttribute('src');
          thumb.alt = '';
          thumb.hidden = true;
        }
      }
    }
  }

  zombiesCombatFeedback(event: ZombiesCombatFeedback): void {
    const confirmation = this.getElement('#zombies-combat-confirmation');
    const parts = [
      event.melee ? 'MELEE' : event.critical ? 'HEADSHOT' : event.killed ? 'ELIMINATED' : 'HIT',
    ];
    if (event.killed && (event.critical || event.melee)) parts.push('ELIMINATED');
    if (event.points > 0) parts.push(`+${event.points}`);
    confirmation.textContent = parts.join(' // ');
    confirmation.classList.toggle('is-critical', event.critical);
    confirmation.classList.toggle('is-kill', event.killed);
    confirmation.classList.remove('hidden');
    this.zombiesCombatTimer = event.killed ? 0.82 : event.critical ? 0.58 : 0.28;

    if (event.killed || event.critical) {
      this.zombiesChain =
        this.zombiesChainTimer > 0 ? this.zombiesChain + 1 : 1;
      this.zombiesChainTimer = event.killed ? 2.8 : 1.8;
      this.getElement('#zombies-combo').textContent =
        `${this.zombiesChain}× COMBAT CHAIN`;
    }
  }

  private showZombiesPointDelta(delta: number): void {
    const element = this.getElement('#zombies-points-delta');
    element.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en-US')}`;
    element.classList.toggle('is-gain', delta > 0);
    element.classList.toggle('is-spend', delta < 0);
    element.classList.remove('hidden');
    this.zombiesPointTimer = 1.05;
  }

  private showZombiesRoundTransition(round: number, advanced: boolean): void {
    this.getElement('#zombies-round-transition-number').textContent =
      `ROUND ${round}`;
    this.getElement('#zombies-round-transition-copy').textContent =
      advanced ? 'NEXT WAVE INBOUND' : 'CONTAINMENT ENGAGED';
    this.getElement('#zombies-round-transition').classList.remove('hidden');
    this.zombiesRoundTimer = advanced ? 2.8 : 1.8;
  }

  private updateZombiesRoomNavigation(
    player: PlayerController,
    navigation: CampusRoomNavigationState,
  ): void {
    const navigator = this.getElement('#zombies-room-navigator');
    this.getElement('#zombies-current-room').textContent =
      navigation.currentRoom.label;

    for (const room of navigation.rooms) {
      const node = this.getElement(`[data-room-nav="${room.id}"]`);
      node.classList.toggle('is-unlocked', room.visited);
      node.classList.toggle('is-active', room.active);
      node.setAttribute(
        'aria-label',
        `${room.label} room, ${room.active ? 'current' : room.visited ? 'visited' : 'not visited'}`,
      );
    }

    const target = navigation.target;
    const visitedCount = navigation.rooms.filter((room) => room.visited).length;
    const allRoomsVisited = visitedCount === navigation.rooms.length;
    navigator.classList.toggle('is-complete', allRoomsVisited);
    const arrow = this.getElement('#zombies-room-nav-arrow');
    const waypoint = this.getElement('#zombies-room-waypoint');
    if (!target) {
      this.getElement('#zombies-next-room').textContent = allRoomsVisited
        ? 'Campus explored'
        : 'Explore connected rooms';
      this.getElement('#zombies-room-distance').textContent =
        `${visitedCount}/${navigation.rooms.length} rooms`;
      this.getElement('#zombies-room-cost').textContent = allRoomsVisited
        ? 'All rooms visited'
        : 'Physical concourse open';
      this.getElement('#zombies-room-bearing').textContent = allRoomsVisited
        ? '✓'
        : 'OPEN';
      arrow.style.transform = 'rotate(0deg)';
      waypoint.classList.add('hidden');
      return;
    }

    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const relativeBearing = Math.atan2(dx, dz) - player.yaw;
    const bearingDegrees = Math.round(
      (((relativeBearing * 180) / Math.PI + 540) % 360) - 180,
    );
    const direction =
      Math.abs(bearingDegrees) <= 12
        ? 'Ahead'
        : bearingDegrees > 0
          ? 'Right'
          : 'Left';

    this.getElement('#zombies-next-room').textContent = target.label;
    this.getElement('#zombies-room-distance').textContent =
      `${Math.round(target.distance)} m`;
    this.getElement('#zombies-room-cost').textContent =
      target.kind === 'power'
        ? target.inRange
          ? 'Hold E // restore facility power'
          : 'Reach the power switch'
        : target.kind === 'door'
          ? target.inRange
            ? `Hold E // ${target.label.toLowerCase()}`
            : `Reach route control // goal: ${target.goalLabel}`
          : target.inRange
            ? `Press E // transit to ${target.label}`
            : `Walk to relay // route goal: ${target.goalLabel}`;
    this.getElement('#zombies-room-bearing').textContent =
      `${direction} ${Math.abs(bearingDegrees)}°`;
    arrow.style.transform = `rotate(${bearingDegrees}deg)`;

    const safeEdgePercent = Math.min(
      22,
      Math.max(8, (58 / Math.max(320, window.innerWidth)) * 100),
    );
    const horizontal = Math.max(
      safeEdgePercent,
      Math.min(
        100 - safeEdgePercent,
        50 + (bearingDegrees / 82) * (50 - safeEdgePercent),
      ),
    );
    waypoint.classList.remove('hidden');
    waypoint.classList.toggle('is-offscreen', Math.abs(bearingDegrees) > 82);
    waypoint.classList.toggle('is-near', target.inRange);
    waypoint.style.left = `${horizontal}%`;
    this.getElement('#zombies-room-waypoint-label').textContent =
      target.inRange ? `E // ${target.label}` : `${target.label} relay`;
    this.getElement('#zombies-room-waypoint-distance').textContent =
      target.inRange ? 'Use relay' : `${Math.round(target.distance)} m`;
  }

  renderZombiesDebrief(result: ZombiesResult): void {
    const panel = this.root.querySelector('.modal[data-mode="dead"] .modal-panel');
    if (!panel) return;
    panel.innerHTML = `
      <p class="eyebrow">Containment overrun</p>
      <h2>Round<br>${result.roundReached}</h2>
      <p class="ops-copy">KILLS ${result.kills} // POINTS ${result.points} // TIME ${formatTime(result.timeMs)}</p>
      <div class="modal-actions">
        <button class="button primary" data-action="restart">Retry arena</button>
        <button class="button" data-action="return-ops">Return to operations</button>
      </div>
    `;
  }

  setPointerPrompt(visible: boolean): void {
    this.getElement('#pointer-prompt').classList.toggle('hidden', !visible);
    const zombiesPrompt = this.root.querySelector('#zombies-pointer-prompt');
    zombiesPrompt?.classList.toggle('hidden', !visible);
  }

  caption(text: string): void {
    for (const id of ['#combat-caption', '#zombies-combat-caption']) {
      const caption = this.root.querySelector<HTMLElement>(id);
      if (!caption) continue;
      caption.textContent = text;
      caption.classList.remove('hidden');
    }
    this.captionTimer = 2.2;
  }

  flashHit(critical: boolean): void {
    for (const selector of ['#hit-marker', '#zombies-hit-marker']) {
      const marker = this.getElement(selector);
      marker.classList.remove('active');
      marker.classList.toggle('is-critical', critical);
      void marker.offsetWidth;
      marker.classList.add('active');
      marker.style.filter = critical ? 'drop-shadow(0 0 5px #ff5147)' : '';
    }
    if (critical) {
      const confirmation = this.root.querySelector<HTMLElement>(
        '#zombies-combat-confirmation',
      );
      if (confirmation) {
        confirmation.textContent = 'HEADSHOT';
        confirmation.classList.add('is-critical');
        confirmation.classList.remove('is-kill', 'hidden');
        this.zombiesCombatTimer = 0.58;
      }
    }
    this.hitTimer = 0.16;
  }

  flashDamage(): void {
    this.damageTimer = 0.28;
  }

  flashScreen(): void {
    this.flashTimer = 0.11;
  }

  renderDebrief(result: MissionResult, bestTimeMs: number | null): void {
    this.getElement('#result-time').textContent = formatTime(result.timeMs);
    this.getElement('#result-best').textContent = formatTime(bestTimeMs);
    this.getElement('#result-accuracy').textContent = `${result.accuracy.toFixed(1)}%`;
    this.getElement('#result-defeated').textContent = String(result.defeated);
    this.getElement('#result-damage').textContent = String(Math.round(result.damageTaken));
    this.getElement('#result-objectives').textContent = `${result.objectivesCompleted}/4`;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('pointerenter', this.onPointerEnter, true);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onInput);
    this.root.innerHTML = '';
  }

  private createMarkup(): string {
    return `
      <section class="screen loading-screen scanlines" data-mode="loading"
        role="status" aria-live="polite" aria-busy="true">
        <div class="loading-card">
          <div class="loading-spinner" aria-hidden="true">
            <span class="loading-spinner-ring"></span>
            <span class="loading-spinner-core"></span>
          </div>
          <p class="eyebrow">Signal Recovery Office // Secure Runtime</p>
          <h1 class="loading-title">Blacksite<small>Echo</small></h1>
          <div class="loading-track"><div class="loading-progress"></div></div>
          <div class="loading-copy"><span id="loading-label">Initializing renderer</span><span id="loading-percent">0%</span></div>
          <p class="loading-error hidden" id="loading-error"></p>
          <button class="button loading-retry hidden" id="loading-retry"
            data-action="retry-loading">Retry loading</button>
        </div>
      </section>

      <section class="screen ops-screen scanlines" data-mode="operations">
        <div class="ops-insignia" aria-hidden="true"></div>
        <div class="ops-sidebar">
          <div>
            <p class="eyebrow">Containment command // Echo Cell</p>
            <h1 class="ops-title">Blacksite<span>Echo</span></h1>
            <p class="ops-copy">CONTAINMENT HAS FAILED. ENTER THE ARENA, SURVIVE THE INFECTED, AND PUSH THE PROTOCOL AS FAR AS YOU CAN.</p>
          </div>
          <nav class="ops-actions" aria-label="Select game mode">
            <button class="ops-zombies-card" data-action="ops-zombies">
              <span class="ops-mode-kicker"><span class="ops-live-dot" aria-hidden="true"></span>Primary mode // Protocol Z</span>
              <strong>Zombies Protocol</strong>
              <span class="ops-mode-copy">Survive escalating rounds. Earn points, restore power, and unlock the arena.</span>
              <span class="ops-mode-launch">Enter containment <span aria-hidden="true">→</span></span>
              <span class="ops-mode-number" aria-hidden="true">01</span>
            </button>
            <div class="ops-side-actions">
              <button class="ops-side-button ops-maps-button" data-action="ops-maps-zombies">
                <span><small>Community mode</small><strong>Maps Outbreak</strong></span>
                <span class="key">02</span>
              </button>
              <button class="ops-side-button ops-story-button" data-action="ops-briefing">
                <span><small>Side operation</small><strong>Story mode</strong></span>
                <span class="key">03</span>
              </button>
              <button class="ops-side-button" data-action="ops-loadout">
                <span>Configure loadout</span><span class="key">04</span>
              </button>
              <button class="ops-side-button" data-action="open-settings">
                <span>Settings</span><span class="key">05</span>
              </button>
              <button class="ops-side-button" data-action="ops-editor">
                <span><small>Development tool</small><strong>Splat editor</strong></span>
                <span class="key">06</span>
              </button>
            </div>
          </nav>
        </div>
        <div class="ops-record">
          <span>Zombies best<strong id="ops-zombies-best">--</strong></span>
          <span>Status<strong id="ops-completion">Not deployed</strong></span>
          <span>Story best<strong id="ops-best-time">--:--.--</strong></span>
          <span>Active kit<strong id="ops-loadout-summary">Vandal / Aegis</strong></span>
        </div>
      </section>

      <section class="screen loadout-screen scanlines" data-mode="loadout">
        <aside class="loadout-column">
          <p class="eyebrow">Armory // Six platform index</p>
          <h1 class="panel-title">Platform<br>selection</h1>
          <div class="weapon-list" id="weapon-list"></div>
          <div class="loadout-footer">
            <button class="button" data-action="back-ops">Return to operations</button>
          </div>
        </aside>
        <section class="loadout-column inspection-space">
          <div class="weapon-preview-viewport corner-mark" id="weapon-preview-viewport"
            role="img" aria-label="Interactive 3D weapon and attachment preview"
            aria-busy="true" data-preview-ready="false">
            <div class="preview-header">
              <span>Live 3D assembly</span>
              <span data-preview-status>Loading Mint platform…</span>
            </div>
            <div class="preview-axis"><span>Muzzle +X</span><span>Drag to rotate</span></div>
          </div>
          <div class="weapon-identity">
            <p class="eyebrow" id="weapon-class">Modular assault rifle</p>
            <h2 id="weapon-name">ARX-7 Vandal</h2>
            <p id="weapon-description"></p>
          </div>
          <div class="quantity-grid" id="weapon-quantities" aria-label="Weapon quantities and runtime values"></div>
          <div class="stats-legend"><span>Base marker</span><span>Current / selected change</span></div>
          <div class="stats" id="weapon-stats"></div>
        </section>
        <aside class="loadout-column">
          <p class="eyebrow">Configuration // Live modifiers</p>
          <div id="attachment-groups"></div>
          <div class="tradeoff" id="tradeoff-copy"></div>
          <section class="attachment-group">
            <h3>Tactical equipment</h3>
            <div class="chip-row">
              <button class="chip" id="equipment-smoke" data-action="select-equipment" data-value="murk-smoke">Murk-3 smoke</button>
              <button class="chip" id="equipment-disruptor" data-action="select-equipment" data-value="volt-disruptor">Volt-9 disruptor</button>
            </div>
          </section>
          <div class="loadout-footer">
            <button class="button primary" id="equip-primary" data-action="equip-primary">Equip primary</button>
            <button class="button" data-action="save-preset">Save preset</button>
            <button class="button" data-action="ops-briefing">Proceed to briefing</button>
          </div>
        </aside>
      </section>

      <section class="screen briefing-screen scanlines" data-mode="briefing">
        <div class="briefing-copy">
          <div>
            <p class="eyebrow">Mission 01 // Signal severance</p>
            <h1>Nadir<br><span>12</span></h1>
            <ul class="briefing-objectives">
              <li>Infiltrate the security checkpoint</li>
              <li>Disable the Eidolon communications array</li>
              <li>Retrieve the encrypted Echo Ledger</li>
              <li>Reach the lower extraction platform</li>
            </ul>
          </div>
          <div>
            <p class="eyebrow">Difficulty protocol</p>
            <div class="difficulty-row">
              <button class="chip" data-action="set-difficulty" data-difficulty="recruit" data-value="recruit">Recruit</button>
              <button class="chip" data-action="set-difficulty" data-difficulty="operative" data-value="operative">Operative</button>
              <button class="chip" data-action="set-difficulty" data-difficulty="blacksite" data-value="blacksite">Blacksite</button>
            </div>
            <div class="loadout-footer">
              <button class="button primary" data-action="deploy">Deploy to Nadir-12</button>
              <button class="button" data-action="back-ops">Return to operations</button>
            </div>
          </div>
        </div>
        <div class="briefing-map corner-mark">
          <div class="map-route">
            <span class="map-node" data-label="Security"></span>
            <span class="map-node" data-label="Eidolon Array"></span>
            <span class="map-node" data-label="Generator Court"></span>
            <span class="map-node" data-label="Extraction"></span>
          </div>
        </div>
      </section>

      <section class="screen briefing-screen maps-create-screen scanlines" data-mode="maps-zombies-create">
        <div class="maps-create-layout">
          <div class="maps-create-main">
            <div class="maps-create-scroll">
              <p class="eyebrow">Maps Outbreak // Street View arena</p>
              <h1>Play a<br><span>shared map</span></h1>
              <p class="ops-copy">Featured arenas ship with the game so anyone can drop in. Or paste your own Street View URL to generate a private draft.</p>
              <p class="maps-url-label">Featured arenas</p>
              <div class="maps-featured-list" id="maps-featured-list"></div>
              <label class="maps-url-label" for="maps-outbreak-url">Google Maps Street View URL</label>
              <textarea id="maps-outbreak-url" class="maps-url-input" rows="3" placeholder="https://www.google.com/maps/@..."></textarea>
              <label class="maps-url-label" for="maps-outbreak-title">Arena title (optional)</label>
              <input id="maps-outbreak-title" class="maps-title-input" type="text" maxlength="80" placeholder="Golden Gate Overlook" />
              <p class="maps-create-status muted" id="maps-outbreak-status" aria-live="polite"></p>
            </div>
            <div class="maps-create-actions">
              <div class="loadout-footer">
                <button class="button primary" data-action="maps-zombies-generate">Generate arena</button>
                <button class="button" data-action="maps-zombies-deploy" id="maps-outbreak-deploy" disabled>Deploy outbreak</button>
                <button class="button" data-action="back-ops">Return to operations</button>
              </div>
              <p class="ops-copy maps-create-hint">Featured Play needs no API key. New generation needs a server <code>MINT_API_KEY</code>. Personal drafts stay in this browser.</p>
            </div>
          </div>
          <aside class="maps-drafts-panel" aria-label="Private arena drafts">
            <div class="maps-drafts-section">
              <p class="maps-url-label">Currently generating</p>
              <div class="maps-drafts-list" id="maps-generating-list"></div>
            </div>
            <div class="maps-drafts-section">
              <p class="maps-url-label">Previously generated</p>
              <div class="maps-drafts-list" id="maps-previous-list"></div>
            </div>
          </aside>
        </div>
      </section>

      <section class="mission-hud" data-mode="mission">
        <div class="hud-objective">
          <small>Active objective</small>
          <strong id="hud-objective-name">Infiltrate Site Nadir-12</strong>
          <span class="muted" id="hud-objective-detail"></span>
          <div class="objective-progress"><span></span></div>
        </div>
        <div class="hud-tactical-map" id="hud-tactical-map">
          <div class="hud-map-frame">
            <div class="hud-map-player" id="hud-map-player" aria-hidden="true"></div>
            <div class="hud-map-objective" id="hud-map-objective" aria-hidden="true"></div>
            <div class="hud-map-edge-arrow hidden" id="hud-map-edge-arrow" aria-hidden="true"></div>
          </div>
          <div class="hud-map-meta">
            <strong id="hud-map-distance">-- m</strong>
            <span id="hud-map-bearing">--°</span>
            <span id="hud-map-elevation">level</span>
          </div>
        </div>
        <div class="hud-vitals">
          <div class="vital-row"><span>Armor</span><span class="vital-track"><span class="vital-fill armor" id="armor-fill"></span></span><strong id="hud-armor">60</strong></div>
          <div class="vital-row"><span>Health</span><span class="vital-track"><span class="vital-fill" id="health-fill"></span></span><strong id="hud-health">100</strong></div>
        </div>
        <div class="spawn-protection hidden" id="spawn-protection" role="status" aria-live="polite">
          <span class="spawn-protection-icon" aria-hidden="true"></span>
          <span><small>Insertion shield</small><strong id="spawn-protection-status">Awaiting control</strong></span>
        </div>
        <div class="hud-weapon">
          <div class="hud-equipment"><small>Tactical [G]</small><strong id="hud-equipment-name">Murk-3</strong><span id="hud-equipment-count">×2</span></div>
          <div class="weapon-slot-strip" aria-label="Weapon shortcuts">
            <span class="weapon-slot is-active" id="hud-weapon-slot-0"><kbd>1</kbd><img class="weapon-slot-thumb" alt="" hidden /><span><b id="hud-weapon-slot-0-name">ARX-7</b><small id="hud-weapon-slot-0-ammo">30/150</small></span></span>
            <span class="weapon-slot" id="hud-weapon-slot-1"><kbd>2</kbd><img class="weapon-slot-thumb" alt="" hidden /><span><b id="hud-weapon-slot-1-name">Aegis</b><small id="hud-weapon-slot-1-ammo">15/60</small></span></span>
            <em><kbd>Q</kbd> Quick swap</em>
          </div>
          <div class="hud-ammo"><small id="hud-weapon-name">ARX-7 Vandal</small><div class="ammo-count"><strong id="hud-magazine">30</strong><span>/ <span id="hud-reserve">150</span></span></div></div>
        </div>
        <div class="reticle"></div>
        <div class="hit-marker" id="hit-marker"></div>
        <div class="interaction-prompt hidden" id="interaction-prompt"></div>
        <button class="pointer-prompt hidden" id="pointer-prompt" data-action="lock-pointer">Click to resume control</button>
        <div class="combat-caption hidden" id="combat-caption"></div>
        <div class="damage-overlay" id="damage-overlay"></div>
        <div class="suppression-overlay" id="suppression-overlay"></div>
        <div class="flash-overlay" id="flash-overlay"></div>
      </section>

      <section class="mission-hud zombies-hud" data-mode="zombies maps-zombies">
        <div class="hud-objective">
          <small>Containment round</small>
          <strong id="zombies-round">1</strong>
          <span class="muted" id="zombies-banner"></span>
        </div>
        <div class="powerup-toast hidden" id="zombies-powerup-toast" role="status" aria-live="polite">
          <span class="powerup-toast-icon powerup-icon" id="zombies-powerup-toast-icon" aria-hidden="true"></span>
          <span>
            <strong id="zombies-powerup-toast-label">Power-up</strong>
            <small id="zombies-powerup-toast-copy"></small>
          </span>
        </div>
        <div class="hud-vitals">
          <div class="vital-row"><span>Armor</span><span class="vital-track" role="meter" aria-label="Armor" aria-valuemin="0" aria-valuemax="60" aria-valuenow="60"><span class="vital-fill armor" id="zombies-armor-fill"></span></span><strong id="zombies-armor">60</strong></div>
          <div class="vital-row"><span>Health</span><span class="vital-track" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="vital-fill" id="zombies-health-fill"></span></span><strong id="zombies-health">100</strong></div>
          <span class="sr-only" id="zombies-health-status" role="status" aria-live="assertive"></span>
        </div>
        <div class="hud-points" aria-label="Points">
          <small>Points</small>
          <strong id="zombies-points">500</strong>
          <span class="points-delta hidden" id="zombies-points-delta" aria-live="polite"></span>
        </div>
        <aside class="room-navigator" id="zombies-room-navigator" aria-label="Room navigation">
          <div class="room-nav-heading">
            <span>Connected campus</span>
            <strong id="zombies-current-room">Hub</strong>
          </div>
          <div class="room-nav-guidance">
            <span class="room-nav-arrow" id="zombies-room-nav-arrow" aria-hidden="true"></span>
            <span class="room-nav-target">
              <small>Current objective</small>
              <strong id="zombies-next-room">North</strong>
              <span><b id="zombies-room-distance">-- m</b><em id="zombies-room-bearing">Ahead 0°</em></span>
            </span>
          </div>
          <div class="room-nav-route" aria-label="Campus room visit route">
            <span data-room-nav="world-zombies-arena">HUB</span>
            <i aria-hidden="true"></i>
            <span data-room-nav="world-zombies-arena-north">NTH</span>
            <i aria-hidden="true"></i>
            <span data-room-nav="world-zombies-arena-far-north">FAR</span>
            <i aria-hidden="true"></i>
            <span data-room-nav="world-zombies-arena-east">EST</span>
            <i aria-hidden="true"></i>
            <span data-room-nav="world-zombies-arena-west">WST</span>
            <i aria-hidden="true"></i>
            <span data-room-nav="world-zombies-arena-south">STH</span>
          </div>
          <p id="zombies-room-cost">Walk to relay // press E</p>
        </aside>
        <div class="room-waypoint hidden" id="zombies-room-waypoint" aria-live="polite">
          <span aria-hidden="true"></span>
          <strong id="zombies-room-waypoint-label">North relay</strong>
          <small id="zombies-room-waypoint-distance">-- m</small>
        </div>
        <div class="hud-perks" id="zombies-perks"></div>
        <div class="hud-weapon">
          <div class="weapon-slot-strip" aria-label="Weapon shortcuts">
            <span class="weapon-slot is-active" id="zombies-weapon-slot-0"><kbd>1</kbd><img class="weapon-slot-thumb" alt="" hidden /><span><b id="zombies-weapon-slot-0-name">Primary</b><small id="zombies-weapon-slot-0-ammo">15/60</small></span></span>
            <span class="weapon-slot" id="zombies-weapon-slot-1"><kbd>2</kbd><img class="weapon-slot-thumb" alt="" hidden /><span><b id="zombies-weapon-slot-1-name">Aegis</b><small id="zombies-weapon-slot-1-ammo">15/60</small></span></span>
            <em><kbd>Q</kbd> Quick swap</em>
          </div>
          <div class="hud-ammo">
            <small id="zombies-weapon-name">Aegis P11</small>
            <div class="ammo-count"><strong id="zombies-magazine">15</strong><span>/ <span id="zombies-reserve">060</span></span></div>
            <span class="ammo-status" id="zombies-ammo-status"></span>
            <span class="reload-track" aria-hidden="true"><span id="zombies-reload-fill"></span></span>
          </div>
        </div>
        <div class="reticle"></div>
        <div class="hit-marker" id="zombies-hit-marker"></div>
        <div class="combat-confirmation hidden" id="zombies-combat-confirmation" role="status" aria-live="polite"></div>
        <div class="combat-combo hidden" id="zombies-combo"></div>
        <div class="round-transition hidden" id="zombies-round-transition" role="status" aria-live="polite">
          <span id="zombies-round-transition-copy">CONTAINMENT ENGAGED</span>
          <strong id="zombies-round-transition-number">ROUND 1</strong>
          <i aria-hidden="true"></i>
        </div>
        <div class="melee-prompt" id="zombies-melee-prompt">
          <kbd>V</kbd><span>or</span><kbd>MMB</kbd><strong id="zombies-melee-action">Melee</strong>
        </div>
        <div class="interaction-prompt hidden" id="zombies-interaction-prompt"></div>
        <button class="pointer-prompt hidden" id="zombies-pointer-prompt" data-action="lock-pointer">Click to resume control</button>
        <div class="combat-caption hidden" id="zombies-combat-caption"></div>
        <div class="last-stand-banner hidden" id="zombies-last-stand" role="alert" aria-live="assertive">
          <span class="last-stand-ring" aria-hidden="true"><b id="zombies-last-stand-progress">0%</b></span>
          <span><strong>LAST STAND</strong><small>Hold E if Quick Pulse owned</small></span>
        </div>
        <div class="downed-presentation hidden" id="zombies-downed-presentation" role="alert" aria-live="assertive">
          <span></span>
          <strong id="zombies-downed-status">DOWNED</strong>
          <small>Run ended</small>
        </div>
        <div class="damage-overlay" id="zombies-damage-overlay"></div>
      </section>

      <section class="modal" data-mode="paused">
        <div class="modal-panel corner-mark">
          <p class="eyebrow">Simulation suspended</p>
          <h2>Paused</h2>
          <div class="controls-reference pause-controls" aria-label="Keyboard and mouse shortcuts">
            <span><kbd>WASD</kbd> Move</span>
            <span><kbd>Mouse</kbd> Look</span>
            <span><kbd>LMB / RMB</kbd> Fire / aim</span>
            <span><kbd>Shift</kbd> Sprint</span>
            <span><kbd>C / Ctrl</kbd> Crouch</span>
            <span><kbd>Space</kbd> Jump</span>
            <span><kbd>R</kbd> Reload</span>
            <span><kbd>Q</kbd> Quick swap</span>
            <span><kbd>1 / 2</kbd> Select weapon</span>
            <span><kbd>V / MMB</kbd> Melee</span>
            <span><kbd>G</kbd> Tactical</span>
            <span><kbd>E</kbd> Interact</span>
            <span><kbd>F</kbd> Inspect</span>
            <span><kbd>Esc</kbd> Resume / pause</span>
          </div>
          <div class="modal-actions">
            <button class="button primary" data-action="resume">Resume mission</button>
            <button class="button" data-action="restart">Restart checkpoint</button>
            <button class="button" data-action="open-pause-settings">Settings & controls</button>
            <button class="button danger" data-action="return-ops">Return to operations</button>
          </div>
        </div>
      </section>

      <section class="modal" data-mode="settings">
        <div class="modal-panel corner-mark">
          <p class="eyebrow">Controls // Audio // Accessibility</p>
          <h2>Settings</h2>
          <div class="controls-reference">
            <span><kbd>WASD</kbd> Move</span>
            <span><kbd>Mouse</kbd> Aim</span>
            <span><kbd>LMB</kbd> Fire</span>
            <span><kbd>RMB</kbd> Aim down sights</span>
            <span><kbd>Shift</kbd> Sprint</span>
            <span><kbd>C / Ctrl</kbd> Crouch</span>
            <span><kbd>Space</kbd> Jump</span>
            <span><kbd>R</kbd> Reload</span>
            <span><kbd>Q</kbd> Quick swap</span>
            <span><kbd>1 / 2</kbd> Select weapon</span>
            <span><kbd>V / MMB</kbd> Melee</span>
            <span><kbd>G</kbd> Tactical</span>
            <span><kbd>E</kbd> Interact</span>
            <span><kbd>F</kbd> Inspect</span>
            <span><kbd>Esc</kbd> Pause</span>
          </div>
          <div class="settings-grid">
            ${this.settingRange('Mouse sensitivity', 'sensitivity', 0.2, 1.5, 0.01)}
            ${this.settingRange('Field of view', 'fov', 70, 105, 1)}
            ${this.settingSelect('Aim behavior', 'aimMode', ['hold', 'toggle'])}
            ${this.settingSelect('Crouch behavior', 'crouchMode', ['hold', 'toggle'])}
            ${this.settingSelect('Sprint behavior', 'sprintMode', ['hold', 'toggle'])}
            ${this.settingCheck('Subtitles', 'subtitles')}
            ${this.settingCheck('Combat captions', 'combatCaptions')}
            ${this.settingCheck('Reduced camera shake', 'reducedShake')}
            ${this.settingCheck('Reduced flashing', 'reducedFlashing')}
            ${this.settingCheck('Motion blur', 'motionBlur')}
            ${this.settingCheck('High-contrast reticle', 'highContrastReticle')}
            ${this.settingSelect('Graphics quality', 'quality', ['low', 'medium', 'high'])}
            ${this.settingRange('Master volume', 'master', 0, 1, 0.01)}
            ${this.settingRange('Effects volume', 'effects', 0, 1, 0.01)}
            ${this.settingRange('Ambience volume', 'ambience', 0, 1, 0.01)}
            ${this.settingRange('Dialogue volume', 'dialogue', 0, 1, 0.01)}
            ${this.settingRange('Interface volume', 'interface', 0, 1, 0.01)}
          </div>
          <div class="modal-actions">
            <button class="button primary" data-action="close-settings">Apply & return</button>
            <button class="button danger" data-action="reset-data">Reset local data</button>
          </div>
        </div>
      </section>

      <section class="modal" data-mode="dead">
        <div class="modal-panel corner-mark">
          <p class="eyebrow">Operative signal lost</p>
          <h2>Mission<br>failed</h2>
          <p class="ops-copy">THE LAST CHECKPOINT REMAINS VALID. HOSTILE POSITIONS WILL RECONSTRUCT FROM THE AUTHORED ENCOUNTER SEED.</p>
          <div class="modal-actions">
            <button class="button primary" data-action="restart">Restart checkpoint</button>
            <button class="button" data-action="return-ops">Return to operations</button>
          </div>
        </div>
      </section>

      <section class="modal" data-mode="complete">
        <div class="modal-panel corner-mark">
          <p class="eyebrow">Mission complete // Echo Ledger secured</p>
          <h2>Signal<br>severed</h2>
          <div class="debrief-grid">
            <div class="debrief-stat"><small>Completion time</small><strong id="result-time">00:00.00</strong></div>
            <div class="debrief-stat"><small>Best result</small><strong id="result-best">00:00.00</strong></div>
            <div class="debrief-stat"><small>Accuracy</small><strong id="result-accuracy">0%</strong></div>
            <div class="debrief-stat"><small>Enemies defeated</small><strong id="result-defeated">0</strong></div>
            <div class="debrief-stat"><small>Damage taken</small><strong id="result-damage">0</strong></div>
            <div class="debrief-stat"><small>Objectives</small><strong id="result-objectives">4/4</strong></div>
          </div>
          <div class="modal-actions">
            <button class="button primary" data-action="replay">Replay mission</button>
            <button class="button" data-action="return-ops">Return to operations</button>
          </div>
        </div>
      </section>
    `;
  }

  private settingRange(
    label: string,
    name: string,
    min: number,
    max: number,
    step: number,
  ): string {
    return `<label class="setting"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-setting="${name}"></label>`;
  }

  private settingSelect(label: string, name: string, values: string[]): string {
    return `<label class="setting"><span>${label}</span><select data-setting="${name}">${values
      .map((value) => `<option value="${value}">${value}</option>`)
      .join('')}</select></label>`;
  }

  private settingCheck(label: string, name: string): string {
    return `<label class="setting"><span>${label}</span><input type="checkbox" data-setting="${name}"></label>`;
  }

  private readonly onClick = (event: Event): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    this.actions.onAction(target.dataset.action ?? '', target.dataset.value);
  };

  private readonly onPointerEnter = (event: Event): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-prefetch]',
    );
    if (!target) return;
    this.actions.onAction(
      target.dataset.prefetch ?? '',
      target.dataset.value,
    );
  };

  private readonly onFocusIn = (event: Event): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-prefetch]',
    );
    if (!target) return;
    this.actions.onAction(
      target.dataset.prefetch ?? '',
      target.dataset.value,
    );
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const setting = target.dataset.setting;
    if (!setting) return;
    let value: string | number | boolean = target.value;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') value = target.checked;
    else if (target instanceof HTMLInputElement && target.type === 'range') value = Number(target.value);
    this.actions.onSetting(setting, value);
  };

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
