export const TOUCH_CONTROLS = [
  'forward',
  'backward',
  'strafe-left',
  'strafe-right',
  'turn-left',
  'turn-right',
  'ascend',
  'descend',
  'jump',
  'interact',
  'secondary-action',
  'posture',
  'precision',
  'emergency-stop',
] as const;

export type TouchControl = (typeof TOUCH_CONTROLS)[number];
export type TouchEdgeControl = Extract<
  TouchControl,
  'jump' | 'interact' | 'secondary-action' | 'posture' | 'emergency-stop'
>;

const TOUCH_CONTROL_SET = new Set<string>(TOUCH_CONTROLS);

export function isTouchControl(value: string | undefined): value is TouchControl {
  return value !== undefined && TOUCH_CONTROL_SET.has(value);
}

export class TouchInputState {
  private readonly pointers = new Map<number, TouchControl>();
  private readonly activeCounts = new Map<TouchControl, number>();
  private readonly pendingEdges = new Set<TouchEdgeControl>();

  press(pointerId: number, control: TouchControl): void {
    this.release(pointerId);
    this.pointers.set(pointerId, control);
    this.activeCounts.set(control, (this.activeCounts.get(control) ?? 0) + 1);
    if (
      control === 'jump' ||
      control === 'interact' ||
      control === 'secondary-action' ||
      control === 'posture' ||
      control === 'emergency-stop'
    ) {
      this.pendingEdges.add(control);
    }
  }

  pulse(control: TouchEdgeControl): void {
    this.pendingEdges.add(control);
  }

  release(pointerId: number): TouchControl | null {
    const control = this.pointers.get(pointerId);
    if (!control) return null;

    this.pointers.delete(pointerId);
    const count = (this.activeCounts.get(control) ?? 1) - 1;
    if (count > 0) this.activeCounts.set(control, count);
    else this.activeCounts.delete(control);
    return control;
  }

  isActive(control: TouchControl): boolean {
    return this.activeCounts.has(control);
  }

  consume(control: TouchEdgeControl): boolean {
    const pending = this.pendingEdges.has(control);
    this.pendingEdges.delete(control);
    return pending;
  }

  clear(): void {
    this.pointers.clear();
    this.activeCounts.clear();
    this.pendingEdges.clear();
  }
}
