import type { RobotId } from '../config/catalog';

const ROBOT_FREQUENCY: Readonly<Record<RobotId, number>> = {
  'axiom-h1': 82,
  'quadrant-q4': 106,
  'forge-t7': 52,
  'swift-w2': 136,
  'kestrel-d5': 188,
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private robotId: RobotId = 'axiom-h1';
  private muted = false;

  constructor() {
    window.addEventListener('pointerdown', this.unlock, { once: true });
    window.addEventListener('keydown', this.unlock, { once: true });
  }

  setRobot(robotId: RobotId): void {
    this.robotId = robotId;
  }

  startEngine(): void {
    if (!this.context || !this.master || this.engineOscillator) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = this.robotId === 'kestrel-d5' ? 'sawtooth' : 'triangle';
    oscillator.frequency.value = ROBOT_FREQUENCY[this.robotId];
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    this.engineOscillator = oscillator;
    this.engineGain = gain;
  }

  updateEngine(speedRatio: number, fault: boolean): void {
    if (!this.context || !this.engineOscillator || !this.engineGain) return;
    const now = this.context.currentTime;
    const base = ROBOT_FREQUENCY[this.robotId];
    this.engineOscillator.frequency.setTargetAtTime(
      base * (1 + Math.min(1.5, speedRatio) * 1.4) * (fault ? 0.6 : 1),
      now,
      0.04,
    );
    this.engineGain.gain.setTargetAtTime(
      this.muted ? 0.0001 : 0.006 + Math.min(1, speedRatio) * 0.018,
      now,
      0.06,
    );
  }

  cue(type: 'objective' | 'success' | 'failure' | 'estop'): void {
    if (!this.context || !this.master || this.muted) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const frequencies = {
      objective: [420, 620],
      success: [420, 840],
      failure: [180, 92],
      estop: [220, 170],
    } as const;
    const [start, end] = frequencies[type];
    oscillator.type = type === 'failure' || type === 'estop' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(end, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.03);
    }
  }

  stopEngine(): void {
    this.engineOscillator?.stop();
    this.engineOscillator?.disconnect();
    this.engineGain?.disconnect();
    this.engineOscillator = null;
    this.engineGain = null;
  }

  get activeEmitters(): number {
    return this.engineOscillator ? 1 : 0;
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    this.stopEngine();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private readonly unlock = () => {
    if (this.context) return;
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.context.destination);
    void this.context.resume();
  };
}
