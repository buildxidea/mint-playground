import { useEffect, useRef, useState } from "react";
import { Draggable } from "./Draggable";
import { attachEasterEggSong } from "../lib/easterEggSong";
import { assetUrl } from "../lib/assetUrl";

type Win = {
  id: string;
  src: string;
  poster?: string;
  title: string;
  style: React.CSSProperties;
  compact?: boolean;
};

/** Outer wrap boxes measured from live heyclicky.com at 1920×1080 */
const wins: Win[] = [
  {
    id: "draw",
    src: assetUrl("heyclicky-draw.mp4"),
    poster: assetUrl("hero-heyclicky-draw-poster.webp"),
    title: "heyclicky-draw.mov",
    style: { left: 767, top: 78, width: 182 },
    compact: true,
  },
  {
    id: "usecase",
    src: assetUrl("usecase.mp4"),
    poster: assetUrl("hero-usecase-poster.webp"),
    title: "usecase.mov",
    style: { left: 1236, top: 115, width: 250 },
    compact: true,
  },
  {
    id: "itdraws",
    src: assetUrl("it-draws-too-omg.mp4"),
    poster: assetUrl("hero-it-draws-too-omg-poster.webp"),
    title: "it-draws-too-omg.mov",
    style: { left: 365, top: 128, width: 123 },
    compact: true,
  },
  {
    id: "nohands",
    src: assetUrl("nohandstricklol.mp4"),
    poster: assetUrl("hero-nohandstricklol-poster.webp"),
    title: "nohandstricklol.mov",
    style: { left: 278, top: 458, width: 222 },
    compact: true,
  },
  {
    id: "daddy",
    src: assetUrl("daddyshome.mp4"),
    poster: assetUrl("hero-daddyshome-poster.webp"),
    title: "daddyshome.mov",
    style: { left: 1502, top: 431, width: 147 },
    compact: true,
  },
];

function FloatingWin({ win }: { win: Win }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  return (
    <Draggable
      className="win decor"
      style={win.style}
      handleSelector=".win-chrome"
    >
      <div className="win-chrome">
        <img src={assetUrl("win-close.png")} alt="" draggable={false} />
        <img src={assetUrl("win-min.png")} alt="" draggable={false} />
        <img src={assetUrl("win-zoom.png")} alt="" draggable={false} />
        <span className="win-title">{win.title}</span>
      </div>
      <div className="win-media">
        <video
          ref={ref}
          src={win.src}
          poster={win.poster}
          muted={muted}
          playsInline
          loop
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (v.paused) {
              void v.play();
              setPlaying(true);
            } else {
              v.pause();
              setPlaying(false);
            }
          }}
        />
        <button
          type="button"
          className="vol-btn"
          aria-label={muted ? "unmute video" : "mute video"}
          aria-pressed={!muted}
          onClick={(e) => {
            e.stopPropagation();
            setMuted((m) => !m);
            if (ref.current) ref.current.muted = !muted;
          }}
        >
          <img
            src={
              muted ? assetUrl("vid-vol-off.svg") : assetUrl("vid-vol-on.svg")
            }
            alt=""
            draggable={false}
          />
        </button>
        {!playing && (
          <button
            type="button"
            className={win.compact ? "play-icon" : "play-cta"}
            aria-label="play video"
            onClick={() => {
              void ref.current?.play();
              setPlaying(true);
            }}
          >
            {win.compact ? (
              <img src={assetUrl("player-play.svg")} alt="" draggable={false} />
            ) : (
              <>
                <img src={assetUrl("play-tri.svg")} alt="" draggable={false} /> play
              </>
            )}
          </button>
        )}
      </div>
      <div className="win-foot">{win.title}</div>
    </Draggable>
  );
}

function NameTag({
  style,
  size = 14,
  dataProp,
}: {
  style: React.CSSProperties;
  size?: number;
  dataProp?: string;
}) {
  return (
    <Draggable className="decor nametag" style={style} data-prop={dataProp}>
      <img src={assetUrl("image10.avif")} alt="" draggable={false} />
      <div className="nametag-label" style={{ fontSize: size }}>
        <span className="nametag-hi">Hello</span>
        <span className="nametag-my">my name is</span>
        <span className="nametag-name">heyclicky</span>
      </div>
    </Draggable>
  );
}

function EggSticker({
  className,
  dataProp,
  song,
  startSec,
  ariaLabel,
  style,
  children,
}: {
  className: string;
  dataProp: string;
  song: string;
  startSec: number;
  ariaLabel: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-prop="${dataProp}"]`,
    );
    if (!el) return;
    return attachEasterEggSong(el, song, startSec);
  }, [dataProp, song, startSec]);

  return (
    <Draggable
      as="button"
      type="button"
      className={className}
      data-prop={dataProp}
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </Draggable>
  );
}

export function Hero({ onOpenTeam }: { onOpenTeam: () => void }) {
  const mainRef = useRef<HTMLVideoElement>(null);
  const [mainPlaying, setMainPlaying] = useState(false);
  const [mainMuted, setMainMuted] = useState(true);

  return (
    <section className="hero" id="top">
      <div className="stage-layer">
        {wins.map((w) => (
          <FloatingWin key={w.id} win={w} />
        ))}

        <Draggable
          as="video"
          className="decor"
          data-prop="spongebob"
          src={assetUrl("gif-spongebob2.mp4")}
          autoPlay
          muted
          loop
          playsInline
          style={{ left: "13.5%", top: "11.7%", width: 114 }}
        />
        <Draggable
          as="video"
          className="decor"
          data-prop="h-bw"
          src={assetUrl("h-bw.mp4")}
          autoPlay
          muted
          loop
          playsInline
          style={{ left: "36.8%", top: "13%", width: 72 }}
        />
        <Draggable
          as="video"
          className="decor"
          data-prop="happy2000"
          src={assetUrl("gif-happy2000.mp4")}
          autoPlay
          muted
          loop
          playsInline
          style={{ left: "81.4%", top: "8.7%", width: 103 }}
        />
        <Draggable
          as="video"
          className="decor"
          data-prop="summerlove"
          src={assetUrl("gif-summerlove.mp4")}
          autoPlay
          muted
          loop
          playsInline
          style={{ left: "57.3%", top: "15.4%", width: 46 }}
        />

        <Draggable
          as="img"
          className="decor"
          data-prop="trash"
          src={assetUrl("sysicon0.avif")}
          alt=""
          style={{ left: "14.64%", top: "30.28%", width: 51 }}
        />
        <Draggable
          as="button"
          type="button"
          className="decor folder-btn"
          data-prop="folder-1"
          aria-label="Open the heyclicky team photo"
          onClick={onOpenTeam}
          style={{ left: "28.65%", top: "25.28%", width: 40 }}
        >
          <img src={assetUrl("sysicon1.avif")} alt="" width={40} draggable={false} />
        </Draggable>
        <Draggable
          as="img"
          className="decor"
          data-prop="folder-2"
          src={assetUrl("sysicon1.avif")}
          alt=""
          style={{ left: "72.55%", top: "48.61%", width: 44 }}
        />
        <EggSticker
          className="decor egg-btn m-pika"
          dataProp="pikachu"
          song="pika-song.m4a"
          startSec={6}
          ariaLabel="Play Pikachu easter egg song"
          style={{ left: "75.26%", top: "54.44%", width: 73 }}
        >
          <img src={assetUrl("gif-pokemon.webp")} alt="" width={73} draggable={false} />
        </EggSticker>
        <Draggable
          as="img"
          className="decor"
          data-prop="beachball"
          src={assetUrl("beachball.svg")}
          alt=""
          style={{ left: "54.27%", top: "22.59%", width: 22, height: 22 }}
        />
        <EggSticker
          className="decor egg-btn m-phone"
          dataProp="phone"
          song="phone-song.m4a"
          startSec={24}
          ariaLabel="Play phone easter egg song"
          style={{
            left: 422,
            top: 639,
            width: 104,
            height: 119,
            transform: "rotate(22deg)",
          }}
        >
          <img
            src={assetUrl("gif-vintagephone.webp")}
            alt=""
            width={104}
            height={119}
            style={{ width: 104, height: 119 }}
            draggable={false}
          />
        </EggSticker>

        <Draggable
          className="decor kao"
          data-prop="kao-1"
          style={{ left: "28%", top: "16%", transform: "rotate(-8deg)" }}
        >
          ^ ω ^
        </Draggable>
        <Draggable
          className="decor kao"
          data-prop="kao-2"
          style={{ left: "68%", top: "36%", transform: "rotate(7deg)" }}
        >
          {"{ ^-^ }"}
        </Draggable>
        <Draggable
          className="decor kao"
          data-prop="kao-3"
          style={{
            left: "24%",
            top: "42%",
            transform: "rotate(-7deg)",
            fontSize: 16,
          }}
        >
          (¬_¬)
        </Draggable>
        <Draggable
          className="decor kao"
          data-prop="kao-4"
          style={{
            left: "48%",
            top: "10%",
            transform: "rotate(-7deg)",
            fontSize: 16,
          }}
        >
          ¯\_(ツ)_/¯
        </Draggable>

        <NameTag
          style={{
            left: "28.85%",
            top: "6.94%",
            width: 76,
            transform: "rotate(4deg)",
          }}
          size={10}
          dataProp="nametag-blue"
        />
        <NameTag
          style={{
            left: "76.56%",
            top: "17.41%",
            width: 104,
            transform: "rotate(-8deg)",
          }}
          size={12}
          dataProp="nametag-red"
        />
      </div>

      <div className="hero-center">
        <h1>heyclicky</h1>
        <p className="sub">an ai buddy that lives on your mac</p>
        <div className="cta-row">
          <a className="btn btn-mac" href="#pricing">
            <span className="gloss" />
            <img src={assetUrl("btn-apple.svg")} alt="" draggable={false} />
            download for mac
          </a>
          <a className="btn btn-win" href="#pricing">
            <img src={assetUrl("btn-windows.svg")} alt="" draggable={false} />
            windows waitlist
          </a>
        </div>
        <p className="fine">100% free. sonoma 14.2 or higher</p>
      </div>

      <div className="win hero-main-win">
        <div className="win-chrome">
          <img src={assetUrl("win-close.png")} alt="" draggable={false} />
          <img src={assetUrl("win-min.png")} alt="" draggable={false} />
          <img src={assetUrl("win-zoom.png")} alt="" draggable={false} />
          <span className="win-title">hello.mov</span>
        </div>
        <div className="win-media">
          {!mainPlaying ? (
            <img
              className="hello-poster"
              src={assetUrl("hero-hello-poster.webp")}
              alt=""
              draggable={false}
            />
          ) : null}
          <video
            ref={mainRef}
            src={assetUrl("hello.mp4")}
            poster={assetUrl("hero-hello-poster.webp")}
            playsInline
            muted={mainMuted}
          />
          <button
            type="button"
            className="vol-btn"
            aria-label={mainMuted ? "unmute video" : "mute video"}
            aria-pressed={!mainMuted}
            onClick={() => {
              setMainMuted((m) => !m);
              if (mainRef.current) mainRef.current.muted = !mainMuted;
            }}
          >
            <img
              src={
                mainMuted ? assetUrl("vid-vol-off.svg") : assetUrl("vid-vol-on.svg")
              }
              alt=""
              draggable={false}
            />
          </button>
          {!mainPlaying && (
            <button
              type="button"
              className="play-cta"
              aria-label="Play the heyclicky video"
              onClick={() => {
                void mainRef.current?.play();
                setMainPlaying(true);
              }}
            >
              <img src={assetUrl("play-tri.svg")} alt="" draggable={false} /> play
              video
            </button>
          )}
        </div>
        <div className="win-foot">hello.mov</div>
      </div>
    </section>
  );
}
