import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/eras.css";
import { Stage } from "./scene/Stage";
import { CarFleet } from "./scene/CarFleet";
import { Turntable } from "./scene/Turntable";
import { Dioramas } from "./scene/Dioramas";
import { Weather } from "./scene/Weather";
import { ScrollTimeline } from "./scroll/ScrollTimeline";
import { buildSections } from "./ui/sections";
import { buildChrome } from "./ui/chrome";
import { createPreloader } from "./ui/preloader";
import { wireInteractions } from "./interactions/interactions";
import { loadProps } from "./scene/props";

async function boot() {
  buildSections();

  const preloader = createPreloader();
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const stage = new Stage(canvas);
  const turntable = new Turntable();
  stage.scene.add(turntable.group);
  const dioramas = new Dioramas(turntable);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const weather = new Weather(reduced);
  stage.scene.add(weather.group);
  // the fleet parents every car to the turntable, so it adds nothing here
  const fleet = new CarFleet(turntable, reduced);

  const timeline = new ScrollTimeline();
  timeline.attach();
  buildChrome(timeline);

  let fatal = false;
  try {
    await fleet.load((loaded, total) => preloader.progress(loaded, total));
  } catch (error) {
    // first loading rejection is terminal for the attempt — latch it
    fatal = true;
    console.error("Fleet loading failed:", error);
    preloader.error("A generation failed to load. Refresh to retry.");
    const toast = document.createElement("div");
    toast.className = "stage-error";
    toast.setAttribute("role", "alert");
    toast.textContent =
      "A car model failed to load. The page will still scroll, but some generations may be missing.";
    document.body.appendChild(toast);
  }

  wireInteractions(stage, fleet, timeline);
  // every listener is wired now — push current scroll state so the opening
  // aerial framing is in place on the very first rendered frame, then snap
  // the rig onto it so it doesn't ease in from the default car framing
  timeline.refresh();
  stage.snap();
  void loadProps(dioramas);

  stage.onUpdate((dt, elapsed) => {
    fleet.update(dt, stage.eraFloat);
    weather.update(dt, elapsed, stage.eraFloat, timeline.state.revealT);
  });

  stage.start();
  if (!fatal) preloader.done();
  else document.getElementById("preloader")?.classList.add("is-done");

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__solvane = {
      stage, fleet, timeline, weather, turntable, dioramas,
    };
  }
}

boot();
