import { useEffect, useState } from "react";
import { MadeWithMint } from "./components/MadeWithMint";
import { Nav, type ViewMode } from "./components/Nav";
import { Hero } from "./components/Hero";
import {
  Faq,
  Features,
  Footer,
  Manifesto,
  Pricing,
  SocialProof,
} from "./components/Sections";
import { SceneOverlay } from "./scene/SceneOverlay";
import { LiquidGlassDefs } from "./components/LiquidGlassDefs";
import { assetUrl } from "./lib/assetUrl";

function initialMode(): ViewMode {
  if (typeof window === "undefined") return "2d";
  const q = new URLSearchParams(window.location.search);
  if (q.has("place") && q.get("place") !== "0") return "3d";
  if (q.has("3d") && q.get("3d") !== "0") return "3d";
  if (q.get("3d") === "0") return "2d";
  return "2d";
}

function syncModeToUrl(mode: ViewMode) {
  if (window.parent !== window) return;
  const url = new URL(window.location.href);
  if (mode === "3d") url.searchParams.set("3d", "1");
  else url.searchParams.delete("3d");
  window.history.replaceState({}, "", url);
}

export default function App() {
  const [teamOpen, setTeamOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>(initialMode);

  useEffect(() => {
    syncModeToUrl(mode);
  }, [mode]);

  return (
    <div className={`app mode-${mode}`}>
      <LiquidGlassDefs />
      <Nav mode={mode} onModeChange={setMode} />
      <Hero onOpenTeam={() => setTeamOpen(true)} />
      <Features />
      <Manifesto />
      <SocialProof />
      <Pricing />
      <Faq />
      <Footer />
      <MadeWithMint />
      {mode === "3d" ? <SceneOverlay forceShow /> : null}

      {teamOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setTeamOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-label="The heyclicky team"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="win-chrome">
              <button
                type="button"
                onClick={() => setTeamOpen(false)}
                style={{ border: 0, background: "transparent", padding: 0 }}
              >
                <img src={assetUrl("win-close.png")} alt="close" width={12} />
              </button>
              <img src={assetUrl("win-min.png")} alt="" width={12} />
              <img src={assetUrl("win-zoom.png")} alt="" width={12} />
              <span className="win-title">the-ogs.png</span>
            </div>
            <img src={assetUrl("hero-modal-team.avif")} alt="The heyclicky team" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
