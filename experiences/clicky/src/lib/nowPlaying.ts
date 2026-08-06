declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          playerVars?: Record<string, number>;
          events?: {
            onReady?: (e: { target: YtPlayer }) => void;
            onStateChange?: (e: { data: number; target: YtPlayer }) => void;
          };
        },
      ) => YtPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
  setVolume: (n: number) => void;
};

let ytApiPromise: Promise<NonNullable<typeof window.YT>> | null = null;

function loadYtApi(): Promise<NonNullable<typeof window.YT>> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

/** Live site Now Playing: YouTube MxekyGtqcNE with volume ducking. */
export function attachNowPlaying(
  mount: HTMLElement,
  onPlayingChange: (playing: boolean) => void,
): { toggle: () => Promise<void>; destroy: () => void } {
  let player: YtPlayer | null = null;
  let wantPlay = false;
  let volRaf = 0;
  let currentVol = 100;

  const ensure = async (autoplay: boolean) => {
    const YT = await loadYtApi();
    if (player) return;
    const host = document.createElement("div");
    mount.appendChild(host);
    if (autoplay) onPlayingChange(true);
    player = new YT.Player(host, {
      videoId: "MxekyGtqcNE",
      playerVars: {
        autoplay: autoplay ? 1 : 0,
        playsinline: 1,
        controls: 0,
        disablekb: 1,
      },
      events: {
        onReady: (e) => {
          if (autoplay || wantPlay) e.target.playVideo();
          wantPlay = false;
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) onPlayingChange(true);
          else if (
            e.data === YT.PlayerState.PAUSED ||
            e.data === YT.PlayerState.ENDED
          ) {
            onPlayingChange(false);
          }
        },
      },
    });
  };

  const duck = () => {
    if (!player?.setVolume) return;
    const busy = Array.from(
      document.querySelectorAll<HTMLMediaElement>("video, audio"),
    ).some((el) => !el.muted && !el.paused && el.volume > 0);
    const target = busy ? 15 : 100;
    cancelAnimationFrame(volRaf);
    const from = currentVol;
    if (from === target) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - t0) / 400));
      currentVol = Math.round(from + t * (2 - t) * (target - from));
      player?.setVolume(currentVol);
      if (t < 1) volRaf = requestAnimationFrame(step);
    };
    volRaf = requestAnimationFrame(step);
  };

  document.addEventListener("volumechange", duck, true);
  document.addEventListener("play", duck, true);
  document.addEventListener("pause", duck, true);

  const toggle = async () => {
    if (!player) {
      await ensure(true);
      return;
    }
    const YT = window.YT;
    if (!YT || typeof player.getPlayerState !== "function") {
      wantPlay = true;
      onPlayingChange(true);
      return;
    }
    if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  };

  return {
    toggle,
    destroy: () => {
      cancelAnimationFrame(volRaf);
      document.removeEventListener("volumechange", duck, true);
      document.removeEventListener("play", duck, true);
      document.removeEventListener("pause", duck, true);
      mount.replaceChildren();
      player = null;
    },
  };
}
