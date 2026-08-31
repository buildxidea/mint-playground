import type { Game } from '../game/Game';
import { FLEET, createFleetOrder, orderFromIds, type BoatSpec } from '../game/fleet';
import { loadSettings, saveSettings, type GameSettings } from '../game/settings';
import { createSeededRandom } from '../utils/random';

const PROGRESS_KEY = 'boatpark-progress';

interface Progress {
  /** Seed behind this run's shuffled fleet order. */
  orderSeed: number;
  /** Boat ids in play order, so a saved run survives a fleet edit. */
  orderIds: string[];
  /** How far along the order the player has unlocked. */
  unlocked: number;
  /** Best star rating per boat id; kept across runs. */
  stars: Record<string, number>;
  /** Set once the last boat is docked, so the next run reshuffles. */
  completed: boolean;
}

function freshOrder(): { orderSeed: number; orderIds: string[] } {
  // Seeded so a saved run replays in the same order; the seed itself is random.
  const orderSeed = Math.floor(Math.random() * 1e9) + 1;
  return { orderSeed, orderIds: createFleetOrder(createSeededRandom(orderSeed)).map((b) => b.id) };
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Progress>;
      const stars = typeof parsed.stars === 'object' && parsed.stars ? parsed.stars : {};
      const ids = Array.isArray(parsed.orderIds) ? parsed.orderIds : [];
      // A finished run — or a save with no usable order — starts a new shuffle.
      if (!parsed.completed && orderFromIds(ids)) {
        return {
          orderSeed: parsed.orderSeed ?? 1,
          orderIds: ids,
          unlocked: Math.min(FLEET.length - 1, Math.max(0, parsed.unlocked ?? 0)),
          stars,
          completed: false,
        };
      }
      return { ...freshOrder(), unlocked: 0, stars, completed: false };
    }
  } catch {
    // Fall through to a fresh run.
  }
  return { ...freshOrder(), unlocked: 0, stars: {}, completed: false };
}

function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage blocked: progress stays session-local.
  }
}

export function initMenu(game: Game): void {
  const menu = document.querySelector<HTMLElement>('#menu');
  const playButton = document.querySelector<HTMLButtonElement>('#play-button');
  const fleetGrid = document.querySelector<HTMLElement>('#fleet-grid');
  if (!menu || !playButton || !fleetGrid) throw new Error('Menu markup missing.');

  let progress = loadProgress();
  let settings = loadSettings();
  let order: BoatSpec[] = orderFromIds(progress.orderIds) ?? [...FLEET];
  game.setFleetOrder(order);
  // Persist immediately: a newly drawn order must survive a reload, or the
  // fleet would reshuffle under the player mid-run.
  saveProgress(progress);

  const showMenu = () => {
    menu.hidden = false;
    document.body.classList.add('menu-open');
    menu.scrollTop = 0;
  };
  const hideMenu = () => {
    menu.hidden = true;
    document.body.classList.remove('menu-open');
  };

  const startLevel = (position: number) => {
    hideMenu();
    game.startLevel(position);
  };

  const renderFleet = () => {
    fleetGrid.innerHTML = '';
    order.forEach((spec, position) => {
      const isNext = position === progress.unlocked;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `fleet-card${isNext ? ' fleet-next' : ''}`;
      const stars = progress.stars[spec.id] ?? 0;
      const rating = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '· · ·';
      button.innerHTML = `
        <span class="fleet-size">${position === 0 ? 'Start' : `#${position + 1}`} · ${spec.length} m</span>
        <span class="fleet-name">${spec.name}</span>
        <span class="fleet-blurb">${spec.blurb}</span>
        <span class="fleet-stars">${rating}</span>
      `;
      button.addEventListener('click', () => startLevel(position));
      fleetGrid.appendChild(button);
    });
  };

  playButton.addEventListener('click', () =>
    startLevel(Math.min(progress.unlocked, order.length - 1)),
  );

  game.onReturnToMenu = () => {
    renderFleet();
    showMenu();
  };

  game.onLevelDocked = (position, stars, boatId) => {
    const best = Math.max(progress.stars[boatId] ?? 0, stars);
    progress = {
      ...progress,
      unlocked: Math.max(progress.unlocked, Math.min(position + 1, order.length - 1)),
      stars: { ...progress.stars, [boatId]: best },
      completed: progress.completed || position === order.length - 1,
    };
    saveProgress(progress);
  };

  // --- Settings ---
  const volume = document.querySelector<HTMLInputElement>('#setting-volume');
  const waves = document.querySelector<HTMLInputElement>('#setting-waves');
  const quality = document.querySelector<HTMLSelectElement>('#setting-quality');
  const cameraMode = document.querySelector<HTMLSelectElement>('#setting-camera');
  const reshuffle = document.querySelector<HTMLButtonElement>('#reshuffle-fleet');

  const applyToControls = () => {
    if (volume) volume.value = String(Math.round(settings.volume * 100));
    if (waves) waves.value = String(Math.round(settings.waveIntensity * 100));
    if (quality) quality.value = settings.quality;
    if (cameraMode) cameraMode.value = settings.cameraMode;
  };

  const commit = (patch: Partial<GameSettings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    game.applySettings(settings);
  };

  volume?.addEventListener('input', () => commit({ volume: Number(volume.value) / 100 }));
  waves?.addEventListener('input', () => commit({ waveIntensity: Number(waves.value) / 100 }));
  quality?.addEventListener('change', () => {
    const value = quality.value;
    commit({ quality: value === 'low' || value === 'medium' ? value : 'high' });
  });
  cameraMode?.addEventListener('change', () =>
    commit({ cameraMode: cameraMode.value === 'high' ? 'high' : 'chase' }),
  );

  reshuffle?.addEventListener('click', () => {
    // A new draw restarts the run, so only offer it before real progress.
    progress = { ...progress, ...freshOrder(), unlocked: 0, completed: false };
    order = orderFromIds(progress.orderIds) ?? [...FLEET];
    game.setFleetOrder(order);
    saveProgress(progress);
    renderFleet();
  });

  // --- Sound: load, unlock on first gesture, and mute ---
  const muteButton = document.querySelector<HTMLButtonElement>('#mute-button');

  const paintMute = () => {
    if (!muteButton) return;
    muteButton.classList.toggle('is-muted', settings.muted);
    muteButton.setAttribute('aria-pressed', String(settings.muted));
    muteButton.setAttribute('aria-label', settings.muted ? 'Unmute sound' : 'Mute sound');
  };

  const setMuted = (muted: boolean) => {
    commit({ muted });
    paintMute();
  };

  muteButton?.addEventListener('click', () => {
    // Clicking mute is itself a gesture, so it can also unlock the context.
    game.audio.resume();
    setMuted(!settings.muted);
  });

  void game.audio.load();

  // Browsers keep audio suspended until the player interacts.
  const unlockAudio = () => {
    game.audio.resume();
    game.audio.startAmbient();
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // --- Boat picker: switch vessel at any time, without the menu ---
  const pickerButton = document.querySelector<HTMLButtonElement>('#boat-picker-button');
  const picker = document.querySelector<HTMLElement>('#boat-picker');
  const pickerGrid = document.querySelector<HTMLElement>('#boat-picker-grid');
  const pickerClose = document.querySelector<HTMLButtonElement>('#boat-picker-close');

  const renderPicker = () => {
    if (!pickerGrid) return;
    pickerGrid.innerHTML = '';
    for (const spec of FLEET) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `picker-card${spec.id === game.currentBoatId ? ' is-current' : ''}`;
      const stars = progress.stars[spec.id] ?? 0;
      card.innerHTML = `
        <span class="picker-name">${spec.name}</span>
        <span class="picker-meta">${spec.length} m · ${stars > 0 ? '★'.repeat(stars) : 'unrated'}</span>
      `;
      card.addEventListener('click', () => {
        closePicker();
        game.startBoat(spec.id);
      });
      pickerGrid.appendChild(card);
    }
  };

  const isPickerOpen = () => Boolean(picker && !picker.hidden);
  const openPicker = () => {
    if (!picker) return;
    renderPicker();
    picker.hidden = false;
  };
  function closePicker(): void {
    if (picker) picker.hidden = true;
  }

  pickerButton?.addEventListener('click', () => (isPickerOpen() ? closePicker() : openPicker()));
  pickerClose?.addEventListener('click', closePicker);
  picker?.addEventListener('click', (event) => {
    if (event.target === picker) closePicker();
  });

  // Capture phase so Escape closes the picker before the game reads it as
  // "back to menu", and B does not fight the boat's controls.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.code === 'Escape' && isPickerOpen()) {
        closePicker();
        event.stopImmediatePropagation();
        return;
      }
      if (event.code === 'KeyM') {
        setMuted(!settings.muted);
        event.stopImmediatePropagation();
        return;
      }
      if (event.code === 'KeyB' && menu.hidden) {
        if (isPickerOpen()) closePicker();
        else openPicker();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  game.onReturnToMenu = () => {
    closePicker();
    renderFleet();
    showMenu();
  };

  paintMute();
  applyToControls();
  renderFleet();
  showMenu();
  game.applySettings(settings);
}
