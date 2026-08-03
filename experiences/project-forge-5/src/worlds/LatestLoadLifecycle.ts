export class LatestLoadLifecycle {
  private revision = 0;
  private disposed = false;

  begin(): number {
    if (this.disposed) {
      throw new Error('Mint World loader has been disposed');
    }
    this.revision += 1;
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  invalidate(): void {
    this.revision += 1;
  }

  dispose(): boolean {
    if (this.disposed) return false;
    this.disposed = true;
    this.revision += 1;
    return true;
  }
}
