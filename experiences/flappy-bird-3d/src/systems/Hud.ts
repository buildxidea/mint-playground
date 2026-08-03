import { birdThumbnailUrl, type BirdId, type BirdOption } from '../assets/assets';

type Screen = 'start' | 'over';

/**
 * DOM overlay: score counter, start and game-over screens, the bird picker,
 * mute toggle, and the asset loading status line.
 */
export class Hud {
  private readonly score = this.getElement('#score');
  private readonly finalScore = this.getElement('#final-score');
  private readonly startOverlay = this.getElement('#start-overlay');
  private readonly gameoverOverlay = this.getElement('#gameover-overlay');
  private readonly muteButton = this.getElement('#mute-button');
  private readonly restartButton = this.getElement('#restart-button');
  private readonly loadingStatus = this.getElement('#loading-status');
  private readonly picker = this.getElement('#bird-picker');
  private readonly birdOptions = this.getElement('#bird-options');
  private readonly pickerDone = this.getElement('#picker-done');
  private readonly changeBirdButtons = [
    this.getElement('#change-bird-start'),
    this.getElement('#change-bird-over'),
  ];

  private readonly cards = new Map<BirdId, HTMLButtonElement>();
  /** Which screen to restore when the picker closes. */
  private returnTo: Screen = 'start';

  constructor() {
    this.pickerDone.addEventListener('click', () => this.closePicker());
    for (const button of this.changeBirdButtons) {
      button.addEventListener('click', () => {
        this.openPicker(button === this.changeBirdButtons[0] ? 'start' : 'over');
      });
    }
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isPickerOpen()) this.closePicker();
    });
  }

  setScore(value: number): void {
    this.score.textContent = String(value);
  }

  showStart(): void {
    this.returnTo = 'start';
    this.startOverlay.classList.remove('hidden');
    this.gameoverOverlay.classList.add('hidden');
  }

  showPlaying(): void {
    this.startOverlay.classList.add('hidden');
    this.gameoverOverlay.classList.add('hidden');
    this.picker.classList.add('hidden');
  }

  showGameOver(score: number): void {
    this.returnTo = 'over';
    this.finalScore.textContent = String(score);
    this.gameoverOverlay.classList.remove('hidden');
  }

  setLoading(message: string | null, isError = false): void {
    if (message === null) {
      this.loadingStatus.classList.add('hidden');
      return;
    }
    this.loadingStatus.classList.remove('hidden');
    this.loadingStatus.classList.toggle('error', isError);
    this.loadingStatus.textContent = message;
  }

  setMuted(muted: boolean): void {
    this.muteButton.innerHTML = muted ? '&#128263;' : '&#128266;';
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
  }

  onMuteToggle(handler: () => void): void {
    this.muteButton.addEventListener('click', () => {
      handler();
      this.muteButton.blur();
    });
  }

  onRestart(handler: () => void): void {
    this.restartButton.addEventListener('click', () => {
      handler();
      this.restartButton.blur();
    });
  }

  /** Build the picker's cards from the roster, using Mint's renders as art. */
  buildBirdOptions(birds: readonly BirdOption[], selected: BirdId, onSelect: (id: BirdId) => void): void {
    this.birdOptions.replaceChildren();
    this.cards.clear();

    for (const bird of birds) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bird-card';
      card.dataset.birdId = bird.id;

      const image = document.createElement('img');
      image.src = birdThumbnailUrl(bird);
      image.alt = '';
      // A missing thumbnail should not leave a broken-image icon in the panel.
      image.addEventListener('error', () => image.remove());

      const label = document.createElement('span');
      label.textContent = bird.name;

      card.append(image, label);
      card.addEventListener('click', () => {
        onSelect(bird.id);
        this.setSelectedBird(bird.id);
        card.blur();
      });

      this.birdOptions.append(card);
      this.cards.set(bird.id, card);
    }
    this.setSelectedBird(selected);
  }

  setSelectedBird(selected: BirdId): void {
    for (const [id, card] of this.cards) {
      card.setAttribute('aria-pressed', String(id === selected));
    }
  }

  isPickerOpen(): boolean {
    return !this.picker.classList.contains('hidden');
  }

  private openPicker(from: Screen): void {
    this.returnTo = from;
    this.startOverlay.classList.add('hidden');
    this.gameoverOverlay.classList.add('hidden');
    this.picker.classList.remove('hidden');
  }

  private closePicker(): void {
    this.picker.classList.add('hidden');
    const restore = this.returnTo === 'start' ? this.startOverlay : this.gameoverOverlay;
    restore.classList.remove('hidden');
    this.pickerDone.blur();
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
