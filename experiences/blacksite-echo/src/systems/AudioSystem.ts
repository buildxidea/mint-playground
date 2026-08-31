import type { MintAssetRuntime } from '../assets/MintAssetRuntime';
import type { AudioSettings } from '../game/types';

type AudioBus =
  | 'effects'
  | 'playerWeapons'
  | 'enemyWeapons'
  | 'ambience'
  | 'dialogue'
  | 'interface';

type AudioBusStrip = {
  input: GainNode;
  compressor: DynamicsCompressorNode;
  level: GainNode;
  duck: GainNode;
};

type VoiceOptions = {
  group?: string;
  limit?: number;
  minInterval?: number;
  playbackRate?: number;
  pan?: number;
  offset?: number;
  duration?: number;
  fadeOut?: number;
  delay?: number;
};

const FOOTSTEP_SEGMENTS = {
  concrete: { offset: 0.56, duration: 0.18 },
  metal: { offset: 0.48, duration: 0.26 },
  wet: { offset: 0.04, duration: 0.25 },
} as const;

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterInput: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly buses = new Map<AudioBus, AudioBusStrip>();
  private noiseBuffer: AudioBuffer | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private readonly ambienceLayers: AudioBufferSourceNode[] = [];
  private ambienceGain: GainNode | null = null;
  private readonly mintBuffers = new Map<string, AudioBuffer>();
  private mintAudioLoading: Promise<void> | null = null;
  private settings: AudioSettings;
  private shotOffset = 0;
  private readonly activeVoices = new Map<string, AudioBufferSourceNode[]>();
  private readonly lastVoiceAt = new Map<string, number>();
  private voicesStarted = 0;
  private voicesStolen = 0;
  private voicesCoalesced = 0;
  private maxConcurrentVoices = 0;
  private maxEnemyVoices = 0;
  private maxFootstepVoices = 0;
  private maxObservedPeak = 0;
  private zombieDeathCues = 0;
  private criticalHitCues = 0;
  private ammoWarningCues = 0;

  get loadedMintEventCount(): number {
    return this.mintBuffers.size;
  }

  get expectedMintEventCount(): number {
    return this.assets?.listArtifacts('audio').length ?? 0;
  }

  get audibleFallbackActive(): boolean {
    return this.assets?.audibleFallbacksAllowed !== false && this.expectedMintEventCount === 0;
  }

  constructor(
    settings: AudioSettings,
    private readonly assets?: MintAssetRuntime,
  ) {
    this.settings = { ...settings };
    const unlock = (): void => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.masterInput = this.context.createGain();
    this.masterLimiter = this.context.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -4;
    this.masterLimiter.knee.value = 0;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.11;
    this.master = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.masterInput
      .connect(this.masterLimiter)
      .connect(this.master)
      .connect(this.analyser)
      .connect(this.context.destination);
    for (const name of [
      'effects',
      'playerWeapons',
      'enemyWeapons',
      'ambience',
      'dialogue',
      'interface',
    ] as const) {
      const input = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor();
      const level = this.context.createGain();
      const duck = this.context.createGain();
      compressor.threshold.value = name === 'enemyWeapons' ? -18 : -12;
      compressor.knee.value = name === 'enemyWeapons' ? 14 : 10;
      compressor.ratio.value = name === 'enemyWeapons' ? 5 : 3;
      compressor.attack.value = name.includes('Weapons') ? 0.002 : 0.008;
      compressor.release.value = name === 'enemyWeapons' ? 0.16 : 0.12;
      input.connect(compressor).connect(level).connect(duck).connect(this.masterInput);
      this.buses.set(name, { input, compressor, level, duck });
    }
    this.noiseBuffer = this.createNoiseBuffer();
    this.applySettings(this.settings);
    await this.context.resume();
    await this.loadMintAudio();
    this.startAmbience();
  }

  async prepareMintAudio(): Promise<void> {
    await this.unlock();
    if (this.mintAudioLoading) await this.mintAudioLoading;
    if (this.expectedMintEventCount === 0) return;
    if (this.loadedMintEventCount === this.expectedMintEventCount) return;

    // A deployment retry gets one fresh network/decode attempt instead of
    // inheriting a settled partial Promise from the original load.
    this.mintAudioLoading = null;
    await this.loadMintAudio();
    if (this.loadedMintEventCount !== this.expectedMintEventCount) {
      throw new Error(
        `Audio readiness failed (${this.loadedMintEventCount}/${this.expectedMintEventCount})`,
      );
    }
  }

  /**
   * Decode only the Zombies-critical cues needed before first playable.
   * Remaining Mint audio continues in the background via prepareMintAudio().
   */
  async prepareCriticalMintAudio(
    artifactIds: readonly string[],
  ): Promise<void> {
    await this.unlock();
    if (!this.context || !this.assets || artifactIds.length === 0) return;
    const missing = artifactIds.filter((id) => !this.mintBuffers.has(id));
    if (missing.length === 0) return;
    await Promise.all(
      missing.map(async (id) => {
        const artifact = this.assets!.listArtifacts('audio').find(
          (entry) => entry.id === id,
        );
        if (!artifact) return;
        const response = await fetch(artifact.publicPath);
        if (!response.ok) {
          throw new Error(
            `Audio request failed (${response.status}): ${artifact.id}`,
          );
        }
        const buffer = await response.arrayBuffer();
        const decoded = await this.context!.decodeAudioData(buffer);
        this.mintBuffers.set(artifact.id, decoded);
      }),
    );
  }

  applySettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(settings.master, now, 0.02);
    for (const [bus, strip] of this.buses) {
      const setting =
        bus === 'playerWeapons' || bus === 'enemyWeapons' ? 'effects' : bus;
      strip.level.gain.setTargetAtTime(settings[setting], now, 0.02);
    }
  }

  ui(frequency = 460): void {
    if (this.playMint('audio-ui', 'interface', 0.32)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(frequency, 0.045, 0.04, 'interface', 'square', frequency * 1.16);
  }

  deploy(): void {
    if (this.playMint('audio-deploy', 'interface', 0.62)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(98, 0.28, 0.13, 'interface', 'sawtooth', 168);
    this.tone(220, 0.22, 0.08, 'interface', 'triangle', 440, 0.08);
  }

  zombiesRoundStart(round = 1): void {
    const playbackRate = 0.96 + Math.min(0.1, Math.max(0, round - 1) * 0.006);
    if (
      this.playMint('audio-zombies-round-start', 'interface', 0.72, {
        group: 'zombies-round-start',
        limit: 1,
        minInterval: 0.25,
        playbackRate,
      })
    ) {
      this.duckBus('ambience', 0.54, 0.7);
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.tone(70 + Math.min(26, round * 2), 0.35, 0.16, 'interface', 'sawtooth', 140);
    this.tone(220, 0.18, 0.055, 'interface', 'triangle', 330, 0.2);
  }

  zombiesPurchase(): void {
    const playbackRate = 0.97 + ((this.voicesStarted * 11) % 7) * 0.01;
    if (
      this.playMint('audio-zombies-purchase', 'interface', 0.55, {
        group: 'zombies-purchase',
        limit: 2,
        minInterval: 0.055,
        playbackRate,
      })
    ) return;
    if (!this.fallbackAllowed()) return;
    this.tone(620, 0.08, 0.04, 'interface', 'square', 880);
  }

  zombiesPowerOn(): void {
    if (this.playMint('audio-zombies-power-on', 'ambience', 0.7)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(48, 0.6, 0.2, 'ambience', 'sawtooth', 96);
  }

  zombiesBoxSpin(): void {
    if (this.playMint('audio-zombies-box-spin', 'effects', 0.6)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(240, 0.4, 0.08, 'effects', 'triangle', 480);
  }

  zombiesPowerUp(): void {
    if (this.playMint('audio-zombies-powerup-grab', 'interface', 0.65)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(880, 0.12, 0.05, 'interface', 'sine', 1320);
  }

  zombiesAttack(): void {
    const playbackRate = 0.91 + ((this.voicesStarted * 19) % 17) / 100;
    if (
      this.playMint('audio-zombies-attack', 'effects', 0.55, {
        group: 'zombies-attack',
        limit: 3,
        minInterval: 0.065,
        playbackRate,
      })
    ) return;
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.1, 0.08, 400);
  }

  zombiesDeath(critical = false): void {
    const variation = (this.zombieDeathCues * 13) % 9;
    const vocal = this.playMint('audio-zombies-attack', 'effects', 0.46, {
      group: 'zombie-death-vocal',
      limit: 4,
      minInterval: 0.07,
      playbackRate: 0.68 + variation * 0.012,
      duration: 1.35,
      fadeOut: 0.35,
    });
    const impact = this.playMint('audio-impact-concrete', 'effects', 0.48, {
      group: 'zombie-death-impact',
      limit: 4,
      minInterval: 0.07,
      delay: 0.62,
      duration: 0.9,
      fadeOut: 0.22,
    });
    const precision = critical
      ? this.playMint('audio-hit-critical', 'interface', 0.34, {
          group: 'zombie-death-precision',
          limit: 2,
          minInterval: 0.045,
          playbackRate: 0.96 + variation * 0.008,
        })
      : false;
    if (vocal || impact || precision) {
      this.zombieDeathCues += 1;
      if (critical) this.criticalHitCues += 1;
      this.duckBus('ambience', critical ? 0.48 : 0.62, 0.28);
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.16, 0.08, 220);
    this.zombieDeathCues += 1;
  }

  gunshot(kind: 'light' | 'rifle' | 'heavy' | 'shotgun', suppressed: boolean): void {
    const mintId = suppressed ? 'audio-gunshot-suppressed' : `audio-gunshot-${kind}`;
    const rateJitter = 0.985 + ((this.voicesStarted * 17) % 23) / 766;
    if (
      this.playMint(mintId, 'playerWeapons', suppressed ? 0.68 : 0.86, {
        group: 'player-gunfire',
        limit: 3,
        minInterval: 0.025,
        playbackRate: rateJitter,
      })
    ) {
      this.duckBus('enemyWeapons', 0.7, 0.12);
      this.duckBus('ambience', 0.58, 0.24);
      return;
    }
    if (!this.fallbackAllowed()) return;
    if (!this.context || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = suppressed
      ? 680
      : kind === 'shotgun'
        ? 1800
        : kind === 'heavy'
          ? 1450
          : 2300;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      suppressed ? 0.055 : kind === 'shotgun' ? 0.24 : kind === 'heavy' ? 0.19 : 0.13,
      now + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (suppressed ? 0.09 : 0.2));
    source.connect(filter).connect(gain).connect(this.getBus('playerWeapons'));
    this.shotOffset = (this.shotOffset + 0.037) % 0.2;
    source.start(now, this.shotOffset, 0.24);
    source.stop(now + 0.25);
    this.tone(
      kind === 'shotgun' ? 74 : kind === 'heavy' ? 82 : kind === 'light' ? 154 : 112,
      suppressed ? 0.06 : 0.12,
      suppressed ? 0.035 : 0.07,
      'effects',
      'triangle',
      52,
    );
  }

  reload(): void {
    const playbackRate = 0.985 + ((this.voicesStarted * 7) % 5) * 0.008;
    if (
      this.playMint('audio-weapon-handling', 'effects', 0.55, {
        group: 'weapon-handling',
        limit: 2,
        minInterval: 0.045,
        playbackRate,
      })
    ) return;
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.055, 0.035, 3200);
    this.tone(620, 0.05, 0.028, 'effects', 'square', 430, 0.08);
  }

  hit(critical: boolean, defeated = false): void {
    const variation = ((this.voicesStarted * 17) % 11) / 1000;
    const played = this.playMint(
      critical ? 'audio-hit-critical' : 'audio-hit',
      'interface',
      defeated ? 0.54 : critical ? 0.5 : 0.42,
      {
        group: critical ? 'critical-hit-confirm' : 'hit-confirm',
        limit: critical ? 2 : 3,
        minInterval: critical ? 0.035 : 0.022,
        playbackRate: 0.992 + variation + (defeated ? -0.035 : 0),
      },
    );
    if (critical) {
      this.criticalHitCues += 1;
      this.duckBus('ambience', defeated ? 0.46 : 0.62, defeated ? 0.26 : 0.14);
      if (played) {
        this.playMint('audio-hit', 'interface', defeated ? 0.22 : 0.14, {
          group: 'critical-hit-body',
          limit: 2,
          minInterval: 0.035,
          playbackRate: defeated ? 0.88 : 1.04,
          delay: 0.018,
        });
      }
    }
    if (played) {
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.tone(
      critical ? 1040 : 820,
      defeated ? 0.085 : 0.05,
      defeated ? 0.045 : 0.035,
      'interface',
      'sine',
      critical ? 1420 : 980,
    );
    if (critical) {
      this.tone(540, 0.065, 0.022, 'interface', 'triangle', defeated ? 310 : 420, 0.015);
    }
  }

  ammoWarning(empty = false): void {
    this.ammoWarningCues += 1;
    if (
      this.playMint('audio-ui', 'interface', empty ? 0.42 : 0.26, {
        group: 'ammo-warning',
        limit: 1,
        minInterval: empty ? 0.18 : 0.7,
        playbackRate: empty ? 0.68 : 0.82,
        duration: empty ? 0.13 : 0.08,
        fadeOut: 0.025,
      })
    ) return;
    if (!this.fallbackAllowed()) return;
    this.tone(empty ? 132 : 270, empty ? 0.11 : 0.065, 0.035, 'interface', 'square', 110);
  }

  zombiesLastStand(): void {
    if (
      this.playMint('audio-player-hurt', 'effects', 0.68, {
        group: 'zombies-last-stand',
        limit: 1,
        minInterval: 2,
        playbackRate: 0.74,
        duration: 1.2,
        fadeOut: 0.3,
      })
    ) {
      this.duckBus('ambience', 0.38, 0.8);
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.tone(58, 0.46, 0.11, 'effects', 'sawtooth', 34);
    this.tone(116, 0.2, 0.04, 'interface', 'square', 86, 0.08);
  }

  hurt(): void {
    if (this.playMint('audio-player-hurt', 'effects', 0.62)) return;
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.12, 0.085, 520);
    this.tone(62, 0.16, 0.08, 'effects', 'sawtooth', 42);
  }

  enemyFire(
    origin: { x: number; y: number; z: number },
    listener: { x: number; y: number; z: number },
  ): void {
    const dx = origin.x - listener.x;
    const dz = origin.z - listener.z;
    const distance = Math.hypot(dx, origin.y - listener.y, dz);
    const attenuation = Math.max(0.18, Math.min(0.82, 1 / (1 + distance * 0.075)));
    const pan = Math.max(-0.86, Math.min(0.86, dx / Math.max(5, Math.abs(dz) + 5)));
    const rateJitter = 0.97 + ((this.voicesStarted * 13) % 31) / 516;
    if (
      this.playMint('audio-enemy-fire', 'enemyWeapons', 0.62 * attenuation, {
        group: 'enemy-gunfire',
        limit: 4,
        minInterval: 0.042,
        playbackRate: rateJitter,
        pan,
      })
    ) {
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.08, 0.045, 1650);
  }

  enemyAlert(): void {
    if (this.playMint('audio-enemy-alert', 'effects', 0.5)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(260, 0.12, 0.04, 'effects', 'square', 540);
  }

  impact(surface: 'concrete' | 'metal'): void {
    if (this.playMint(`audio-impact-${surface}`, 'effects', 0.5)) return;
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.045, 0.028, surface === 'metal' ? 3200 : 1200);
  }

  footstep(surface: 'concrete' | 'metal' | 'wet'): void {
    const segment = FOOTSTEP_SEGMENTS[surface];
    if (
      this.playMint(`audio-footstep-${surface}`, 'effects', 0.25, {
        group: 'player-footsteps',
        limit: 1,
        minInterval: 0.24,
        offset: segment.offset,
        duration: segment.duration,
        fadeOut: 0.045,
      })
    ) {
      return;
    }
    if (!this.fallbackAllowed()) return;
    this.noiseBurst(0.035, 0.018, surface === 'metal' ? 2200 : surface === 'wet' ? 620 : 980);
  }

  alarm(): void {
    if (this.playMint('audio-alarm', 'ambience', 0.62)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(410, 0.45, 0.08, 'ambience', 'square', 300);
    this.tone(410, 0.45, 0.07, 'ambience', 'square', 300, 0.52);
  }

  equipment(): void {
    if (this.playMint('audio-equipment', 'effects', 0.7)) return;
    if (!this.fallbackAllowed()) return;
    this.tone(180, 0.3, 0.1, 'effects', 'sine', 860);
  }

  extraction(): void {
    if (this.playMint('audio-extraction', 'interface', 0.72)) return;
    if (!this.fallbackAllowed()) return;
    [110, 165, 220, 330].forEach((frequency, index) => {
      this.tone(frequency, 0.72, 0.055, 'interface', 'triangle', frequency * 1.5, index * 0.12);
    });
  }

  pause(paused: boolean): void {
    if (!this.context || !this.ambienceGain) return;
    this.ambienceGain.gain.setTargetAtTime(
      paused ? 0.12 : 0.34,
      this.context.currentTime,
      0.08,
    );
  }

  dispose(): void {
    this.ambienceSource?.stop();
    this.ambienceLayers.forEach((source) => source.stop());
    this.ambienceLayers.length = 0;
    this.activeVoices.forEach((voices) => voices.forEach((voice) => voice.stop()));
    this.activeVoices.clear();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buses.clear();
    this.masterInput = null;
    this.masterLimiter = null;
    this.analyser = null;
  }

  private getBus(bus: AudioBus): AudioNode {
    return this.buses.get(bus)?.input ?? this.masterInput ?? this.context!.destination;
  }

  private tone(
    start: number,
    duration: number,
    volume: number,
    bus: AudioBus,
    type: OscillatorType,
    end = start,
    delay = 0,
  ): void {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.getBus(bus));
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noiseBurst(duration: number, volume: number, cutoff: number): void {
    if (!this.context || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.getBus('effects'));
    source.start(now, 0, duration);
  }

  private createNoiseBuffer(): AudioBuffer {
    const length = Math.floor(this.context!.sampleRate * 1.2);
    const buffer = this.context!.createBuffer(1, length, this.context!.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 173;
    for (let index = 0; index < data.length; index += 1) {
      state = (state * 16807) % 2147483647;
      data[index] = (state / 2147483647) * 2 - 1;
    }
    return buffer;
  }

  private startAmbience(): void {
    if (!this.context || this.ambienceSource) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const mintAmbience = this.mintBuffers.get('audio-ambience');
    source.buffer = mintAmbience ?? (this.fallbackAllowed() ? this.noiseBuffer : null);
    if (!source.buffer) return;
    source.loop = true;
    gain.gain.value = 0.34;
    if (mintAmbience) {
      source.connect(gain).connect(this.getBus('ambience'));
    } else {
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      filter.Q.value = 0.4;
      source.connect(filter).connect(gain).connect(this.getBus('ambience'));
    }
    source.start();
    this.ambienceSource = source;
    this.ambienceGain = gain;
    for (const [id, volume] of [
      ['audio-ventilation', 0.12],
      ['audio-machinery', 0.09],
      ['audio-electrical-hum', 0.07],
    ] as const) {
      const layerBuffer = this.mintBuffers.get(id);
      if (!layerBuffer) continue;
      const layer = this.context.createBufferSource();
      const layerGain = this.context.createGain();
      layer.buffer = layerBuffer;
      layer.loop = true;
      layerGain.gain.value = volume;
      layer.connect(layerGain).connect(this.getBus('ambience'));
      layer.start();
      this.ambienceLayers.push(layer);
    }
  }

  diagnostics(): {
    activeVoices: number;
    activeEnemyVoices: number;
    activeFootstepVoices: number;
    maxConcurrentVoices: number;
    maxEnemyVoices: number;
    maxFootstepVoices: number;
    voicesStarted: number;
    voicesStolen: number;
    voicesCoalesced: number;
    masterPeak: number;
    limiterReduction: number;
    zombieDeathCues: number;
    criticalHitCues: number;
    ammoWarningCues: number;
  } {
    if (this.analyser) {
      const samples = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      this.maxObservedPeak = Math.max(this.maxObservedPeak, peak);
    }
    return {
      activeVoices: this.activeVoiceCount(),
      activeEnemyVoices: this.activeVoices.get('enemy-gunfire')?.length ?? 0,
      activeFootstepVoices: this.activeVoices.get('player-footsteps')?.length ?? 0,
      maxConcurrentVoices: this.maxConcurrentVoices,
      maxEnemyVoices: this.maxEnemyVoices,
      maxFootstepVoices: this.maxFootstepVoices,
      voicesStarted: this.voicesStarted,
      voicesStolen: this.voicesStolen,
      voicesCoalesced: this.voicesCoalesced,
      masterPeak: this.maxObservedPeak,
      limiterReduction: this.masterLimiter?.reduction ?? 0,
      zombieDeathCues: this.zombieDeathCues,
      criticalHitCues: this.criticalHitCues,
      ammoWarningCues: this.ammoWarningCues,
    };
  }

  async captureStressMix(durationSeconds = 4): Promise<string | null> {
    await this.unlock();
    if (
      !this.context ||
      !this.master ||
      typeof MediaRecorder === 'undefined' ||
      typeof this.context.createMediaStreamDestination !== 'function'
    ) {
      return null;
    }
    const destination = this.context.createMediaStreamDestination();
    this.master.connect(destination);
    const preferred = 'audio/webm;codecs=opus';
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'audio/webm';
    const recorder = new MediaRecorder(destination.stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(120);
    const startedAt = performance.now();
    let tick = 0;
    const timer = window.setInterval(() => {
      const side = tick % 2 === 0 ? -1 : 1;
      this.enemyFire(
        { x: side * (5 + (tick % 4) * 2), y: 1.2, z: -10 - (tick % 5) * 3 },
        { x: 0, y: 1, z: 0 },
      );
      if (tick % 5 === 0) this.gunshot('rifle', false);
      if (tick % 7 === 0) this.impact(tick % 14 === 0 ? 'metal' : 'concrete');
      tick += 1;
      if (performance.now() - startedAt >= durationSeconds * 1000) {
        window.clearInterval(timer);
        recorder.stop();
      }
    }, 68);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    this.master.disconnect(destination);
    const blob = new Blob(chunks, { type: mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }

  private playMint(
    id: string,
    bus: AudioBus,
    volume: number,
    options: VoiceOptions = {},
  ): boolean {
    if (!this.context) return false;
    const buffer = this.mintBuffers.get(id);
    if (!buffer) return false;
    const group = options.group ?? id;
    const now = this.context.currentTime;
    const last = this.lastVoiceAt.get(group) ?? -Infinity;
    if (options.minInterval && now - last < options.minInterval) {
      this.voicesCoalesced += 1;
      return true;
    }
    this.lastVoiceAt.set(group, now);
    const voices = this.activeVoices.get(group) ?? [];
    const limit = Math.max(1, options.limit ?? 8);
    while (voices.length >= limit) {
      const oldest = voices.shift();
      if (!oldest) break;
      oldest.stop();
      this.voicesStolen += 1;
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate ?? 1;
    const offset = Math.min(
      Math.max(0, options.offset ?? 0),
      Math.max(0, buffer.duration - 0.001),
    );
    const duration = Math.min(
      Math.max(0.001, options.duration ?? buffer.duration - offset),
      Math.max(0.001, buffer.duration - offset),
    );
    const fadeOut = Math.min(Math.max(0, options.fadeOut ?? 0), duration);
    const startAt = now + Math.max(0, options.delay ?? 0);
    gain.gain.setValueAtTime(volume, startAt);
    if (fadeOut > 0) {
      gain.gain.setValueAtTime(volume, startAt + duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    }
    source.connect(gain);
    if (typeof options.pan === 'number' && typeof this.context.createStereoPanner === 'function') {
      const panner = this.context.createStereoPanner();
      panner.pan.value = options.pan;
      gain.connect(panner).connect(this.getBus(bus));
    } else {
      gain.connect(this.getBus(bus));
    }
    voices.push(source);
    this.activeVoices.set(group, voices);
    source.onended = () => {
      const active = this.activeVoices.get(group);
      if (!active) return;
      const index = active.indexOf(source);
      if (index >= 0) active.splice(index, 1);
      if (active.length === 0) this.activeVoices.delete(group);
    };
    this.voicesStarted += 1;
    this.maxConcurrentVoices = Math.max(this.maxConcurrentVoices, this.activeVoiceCount());
    if (group === 'enemy-gunfire') {
      this.maxEnemyVoices = Math.max(this.maxEnemyVoices, voices.length);
    } else if (group === 'player-footsteps') {
      this.maxFootstepVoices = Math.max(this.maxFootstepVoices, voices.length);
    }
    source.start(startAt, offset, duration);
    return true;
  }

  private activeVoiceCount(): number {
    let count = 0;
    for (const voices of this.activeVoices.values()) count += voices.length;
    return count;
  }

  private duckBus(bus: AudioBus, factor: number, seconds: number): void {
    if (!this.context) return;
    const strip = this.buses.get(bus);
    if (!strip) return;
    const now = this.context.currentTime;
    strip.duck.gain.cancelScheduledValues(now);
    strip.duck.gain.setTargetAtTime(factor, now, 0.012);
    strip.duck.gain.setTargetAtTime(1, now + seconds, Math.max(0.035, seconds * 0.28));
  }

  private async loadMintAudio(): Promise<void> {
    if (!this.context || !this.assets) return;
    if (this.mintAudioLoading) return this.mintAudioLoading;
    const artifacts = this.assets.listArtifacts('audio');
    if (artifacts.length === 0) return;
    this.mintAudioLoading = Promise.all(
      artifacts.map(async (artifact) => {
        const response = await fetch(artifact.publicPath);
        if (!response.ok) {
          throw new Error(`Audio request failed (${response.status}): ${artifact.id}`);
        }
        const buffer = await response.arrayBuffer();
        const decoded = await this.context!.decodeAudioData(buffer);
        this.mintBuffers.set(artifact.id, decoded);
      }),
    )
      .then(() => {
        if (this.ambienceSource) {
          this.ambienceSource.stop();
          this.ambienceSource = null;
          this.ambienceGain = null;
        }
        this.ambienceLayers.forEach((source) => source.stop());
        this.ambienceLayers.length = 0;
      })
      .catch((error) => {
        console.warn('One or more Mint audio artifacts failed to load.', error);
      });
    return this.mintAudioLoading;
  }

  private fallbackAllowed(): boolean {
    return this.assets?.audibleFallbacksAllowed !== false;
  }
}
