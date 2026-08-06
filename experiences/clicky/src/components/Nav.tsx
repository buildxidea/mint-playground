import { useEffect, useRef, useState } from "react";
import { attachNowPlaying } from "../lib/nowPlaying";
import { assetUrl } from "../lib/assetUrl";

export type ViewMode = "2d" | "3d";

function LogoMark() {
  return (
    <svg className="clicky-logo" viewBox="0 0 48 31" aria-label="heyclicky">
      <path
        d="M4 22 C10 6, 16 26, 24 10 C30 0, 36 22, 44 12"
        fill="none"
        stroke="#111"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Nav({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  const [time, setTime] = useState("");
  const [npPlaying, setNpPlaying] = useState(false);
  const npMountRef = useRef<HTMLSpanElement>(null);
  const npApiRef = useRef<ReturnType<typeof attachNowPlaying> | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const mount = npMountRef.current;
    if (!mount) return;
    const api = attachNowPlaying(mount, setNpPlaying);
    npApiRef.current = api;
    return () => {
      api.destroy();
      npApiRef.current = null;
    };
  }, []);

  const toggleNp = () => {
    void npApiRef.current?.toggle();
  };

  return (
    <header className="nav">
      <div className="nav-left">
        <a href="#top">heyclicky</a>
        <a href="#feat">features</a>
        <a href="#pricing">pricing</a>
        <div
          className="mode-toggle"
          role="group"
          aria-label="2D or 3D stickers"
        >
          <button
            type="button"
            className={mode === "2d" ? "on" : ""}
            aria-pressed={mode === "2d"}
            onClick={() => onModeChange("2d")}
          >
            2D
          </button>
          <button
            type="button"
            className={mode === "3d" ? "on" : ""}
            aria-pressed={mode === "3d"}
            onClick={() => onModeChange("3d")}
          >
            3D
          </button>
        </div>
      </div>
      <a className="nav-logo" href="#top" aria-label="heyclicky — home">
        <LogoMark />
      </a>
      <div className="nav-right">
        <div className="status-tray">
          <img src={assetUrl("status-vol.svg")} alt="" width={17} />
          <img src={assetUrl("status-nowplaying.avif")} alt="" width={17} />
          <button
            type="button"
            className={`np-btn${npPlaying ? " playing" : ""}`}
            aria-label={npPlaying ? "Pause now playing" : "Play now playing"}
            aria-pressed={npPlaying}
            onClick={toggleNp}
          >
            <img src={assetUrl("status-headphones.svg")} alt="" />
          </button>
          <span className="np-player" aria-hidden="true" ref={npMountRef} />
          <img src={assetUrl("nav-headphones.svg")} alt="" width={14} />
          <img src={assetUrl("nav-wifi.svg")} alt="" width={14} />
          <img src={assetUrl("nav-bluetooth.svg")} alt="" width={12} />
          <img src={assetUrl("nav-control-center.png")} alt="" width={14} />
          <img src={assetUrl("status-check.svg")} alt="" width={12} />
          <button
            type="button"
            className="np-play-icon"
            aria-label={npPlaying ? "Pause now playing" : "Play now playing"}
            onClick={toggleNp}
          >
            <img
              src={npPlaying ? assetUrl("nav-pause.svg") : assetUrl("nav-play.svg")}
              alt=""
              width={12}
            />
          </button>
          <img src={assetUrl("status-check.svg")} alt="" width={12} />
          <img src={assetUrl("mcc-battery.png")} alt="" width={22} />
          <span>{time}</span>
        </div>
        <a className="cta-link" href="#pricing">
          <img src={assetUrl("nav-apple.svg")} alt="" /> get heyclicky
        </a>
      </div>
    </header>
  );
}
