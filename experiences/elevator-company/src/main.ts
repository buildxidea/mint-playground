import { loadAssets } from "./assets-load";
import { buildWorld } from "./scene";
import { App } from "./app";
import {
  failLoading,
  finishLoading,
  setLoadingProgress,
  setLoadingStatus,
} from "./overlay";

async function boot(): Promise<void> {
  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("Missing #scene canvas");

  setLoadingStatus("PREPARING CAR…");
  try {
    const assets = await loadAssets(setLoadingProgress);
    const world = buildWorld(assets);
    const app = new App(world, canvas);
    // Dev-only inspection handle for QA tooling.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__elevate = { world, app };
    }
    scrollTo(0, 0);
    finishLoading();
  } catch (err) {
    console.error(err);
    failLoading("OUT OF SERVICE — ASSET LOAD FAILED");
  }
}

void boot();
