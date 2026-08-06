import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  readPropRotateRad,
  seedPropRotationBases,
} from "../lib/propTransform";
import { assetUrl } from "../lib/assetUrl";
import manifestData from "./scene-manifest.json";
import { AnchoredBillboard, AnchoredKaoText } from "./AnchoredBillboard";

type PropEntry = {
  id: string;
  model: string;
  section: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  visible: boolean;
  media?: {
    kind: "image" | "video";
    src: string;
  };
  text?: string;
  anchor?: {
    x: number;
    y: number;
    w: number;
    h: number;
    left: number;
    top: number;
  };
};

type Manifest = {
  version: number;
  props: PropEntry[];
  models: Record<string, string>;
};

declare global {
  interface Window {
    __SCENE_SCREEN__?: Array<{
      id: string;
      x: number;
      y: number;
      visible: boolean;
      section: string;
    }>;
    __SCENE_MANIFEST__?: Manifest;
  }
}

const MODEL_LIBRARY = [
  "trash",
  "folder",
  "phone",
  "beachball",
  "nametag",
  "flower",
  "mail",
  "cat",
  "astro",
  "laptop",
  "noregrets",
  "cap",
  "justshipit",
  "robot",
  "octocat",
  "win-frame",
  "logo-mark",
  "pikachu",
  "spongebob",
  "pr-nocap",
  "happy2000",
  "summerlove",
  "h-bw",
  "kao-1",
  "kao-2",
  "kao-3",
  "kao-4",
] as const;

/** World units that roughly match ~100 CSS px at the default camera. */
const PX_TO_WORLD = 0.0054;

/** Gentle yaw amplitude (radians) + speed for idle turns. */
const IDLE_YAW = 0.22;
const IDLE_SPEED = 0.55;

function idlePhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

const INITIAL_MANIFEST = manifestData as unknown as Manifest;
const PRELOAD_MODELS = INITIAL_MANIFEST.models ?? {};
for (const path of Object.values(PRELOAD_MODELS)) {
  useGLTF.preload(path);
}

function screenToWorld(
  sx: number,
  sy: number,
  camera: THREE.Camera,
  size: { width: number; height: number },
  z = 0,
): THREE.Vector3 {
  const ndcX = (sx / size.width) * 2 - 1;
  const ndcY = -(sy / size.height) * 2 + 1;
  const origin = new THREE.Vector3(
    camera.position.x,
    camera.position.y,
    camera.position.z,
  );
  const target = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const dir = target.sub(origin).normalize();
  const t = (z - origin.z) / dir.z;
  return origin.add(dir.multiplyScalar(t));
}

/**
 * Pins a GLB to the live `[data-prop]` DOM box so 3D mode keeps the same
 * layout as 2D — only the object representation changes.
 */
function AnchoredProp({
  prop,
  path,
  followDom,
  selected,
  onSelect,
}: {
  prop: PropEntry;
  path: string;
  followDom: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  const { scene } = useGLTF(path);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const phase = useMemo(() => idlePhase(prop.id), [prop.id]);
  const baseSize = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const s = new THREE.Vector3();
    box.getSize(s);
    return Math.max(s.x, s.y, 0.001);
  }, [cloned]);

  useFrame((state) => {
    const g = group.current;
    const s = spin.current;
    if (!g) return;

    if (s) {
      s.rotation.y =
        Math.sin(state.clock.elapsedTime * IDLE_SPEED + phase) * IDLE_YAW;
    }

    if (!followDom) {
      g.visible = prop.visible;
      g.position.set(prop.position[0], prop.position[1], prop.position[2]);
      g.rotation.set(prop.rotation[0], prop.rotation[1], prop.rotation[2]);
      g.scale.setScalar(prop.scale);
      return;
    }

    const el = document.querySelector<HTMLElement>(
      `[data-prop="${prop.id}"]`,
    );
    if (!el) {
      g.visible = false;
      return;
    }

    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const onScreen =
      r.bottom > -40 && r.top < vh + 40 && r.right > -40 && r.left < vw + 40;
    if (!onScreen || r.width < 1 || r.height < 1) {
      g.visible = false;
      return;
    }

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (el.dataset.propZBase === undefined) {
      el.dataset.propZBase = String(prop.position[2] ?? 0);
    }
    seedPropRotationBases(el, prop.rotation);
    const zOverride = parseFloat(el.dataset.propZ ?? "");
    const z =
      Number.isFinite(zOverride) ? zOverride : (prop.position[2] ?? 0);
    const world = screenToWorld(cx, cy, camera, size, z);
    const targetPx = Math.max(r.width, r.height);
    const worldScale = (targetPx * PX_TO_WORLD) / baseSize;

    const rx = readPropRotateRad(el, "x", prop.rotation[0]);
    const ry = readPropRotateRad(el, "y", prop.rotation[1]);
    const rz = readPropRotateRad(el, "z", prop.rotation[2]);

    g.visible = true;
    g.position.copy(world);
    g.rotation.set(rx, ry, rz);
    g.scale.setScalar(Math.max(0.05, worldScale));
  });

  return (
    <group ref={group}>
      <group ref={spin}>
        <primitive
          object={cloned}
          onClick={(e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onSelect();
          }}
          onPointerDown={(e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onSelect();
          }}
        />
      </group>
      {selected ? (
        <mesh position={[0, -0.01, 0]}>
          <ringGeometry args={[0.6, 0.75, 32]} />
          <meshBasicMaterial color="#0a84ff" transparent opacity={0.55} />
        </mesh>
      ) : null}
    </group>
  );
}

/** Publishes projected screen positions for the place→verify loop */
function SceneReporter({
  props,
  followDom,
}: {
  props: PropEntry[];
  followDom: boolean;
}) {
  const { camera, size } = useThree();
  const v = useRef(new THREE.Vector3());

  useFrame(() => {
    window.__SCENE_SCREEN__ = props
      .filter((p) => p.visible)
      .map((p) => {
        if (followDom) {
          const el = document.querySelector<HTMLElement>(
            `[data-prop="${p.id}"]`,
          );
          if (!el) {
            return {
              id: p.id,
              x: -1,
              y: -1,
              visible: false,
              section: p.section,
            };
          }
          const r = el.getBoundingClientRect();
          return {
            id: p.id,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            visible: true,
            section: p.section,
          };
        }
        v.current.set(p.position[0], p.position[1], p.position[2]);
        v.current.project(camera);
        return {
          id: p.id,
          x: Math.round((v.current.x * 0.5 + 0.5) * size.width),
          y: Math.round((-v.current.y * 0.5 + 0.5) * size.height),
          visible: p.visible,
          section: p.section,
        };
      });
  });

  return null;
}

function useQueryFlags(forceShow = false) {
  return useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      place: q.has("place") && q.get("place") !== "0",
      show3d:
        forceShow ||
        (q.has("3d") ? q.get("3d") !== "0" : q.has("place")),
    };
  }, [forceShow]);
}

const SECTION_SEL: Record<string, string> = {
  hero: ".hero, #top",
  manifesto: ".man-section",
  social: "section.fb",
  pricing: "#pricing, section.pr",
  features: ".feat-section, section.feat, #feat",
};

function useActiveSections() {
  const [active, setActive] = useState<Set<string>>(() => new Set(["hero"]));

  useEffect(() => {
    const update = () => {
      const next = new Set<string>();
      const vh = window.innerHeight;
      for (const [id, sel] of Object.entries(SECTION_SEL)) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > vh * 0.12 && r.top < vh * 0.88) next.add(id);
      }
      if (window.scrollY < 80) next.add("hero");
      setActive(next);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return active;
}

export function SceneOverlay({ forceShow = false }: { forceShow?: boolean }) {
  const flags = useQueryFlags(forceShow);
  const [manifest, setManifest] = useState<Manifest>(INITIAL_MANIFEST);
  const [placeMode, setPlaceMode] = useState(flags.place);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addModel, setAddModel] = useState<string>("folder");
  const activeSections = useActiveSections();
  const followDom = !placeMode;

  useEffect(() => {
    window.__SCENE_MANIFEST__ = manifest;
  }, [manifest]);

  const visibleProps = useMemo(
    () =>
      manifest.props.filter(
        (p) => p.visible && (placeMode || activeSections.has(p.section)),
      ),
    [manifest.props, activeSections, placeMode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") {
        setPlaceMode((v) => !v);
      }
      if (!selectedId || !placeMode) return;
      setManifest((m) => {
        const props = m.props.map((p) => {
          if (p.id !== selectedId) return p;
          const next = {
            ...p,
            position: [...p.position] as [number, number, number],
            rotation: [...p.rotation] as [number, number, number],
          };
          const step = e.shiftKey ? 0.25 : 0.08;
          if (e.key === "ArrowLeft") next.position[0] -= step;
          if (e.key === "ArrowRight") next.position[0] += step;
          if (e.key === "ArrowUp") next.position[1] += step;
          if (e.key === "ArrowDown") next.position[1] -= step;
          if (e.key === "[") next.scale = Math.max(0.1, next.scale - 0.05);
          if (e.key === "]") next.scale += 0.05;
          if (e.key === ",")
            next.rotation = [
              next.rotation[0],
              next.rotation[1],
              next.rotation[2] - 0.1,
            ];
          if (e.key === ".")
            next.rotation = [
              next.rotation[0],
              next.rotation[1],
              next.rotation[2] + 0.1,
            ];
          return next;
        });
        return { ...m, props };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, placeMode]);

  const selected = manifest.props.find((p) => p.id === selectedId) ?? null;

  const exportManifest = () => {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene-manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const addProp = () => {
    const id = `${addModel}-${Date.now().toString(36)}`;
    setManifest((m) => ({
      ...m,
      props: [
        ...m.props,
        {
          id,
          model: addModel,
          section: "hero",
          position: [0, 1.2, 0.2],
          rotation: [0, 0, 0],
          scale: 0.5,
          visible: true,
        },
      ],
    }));
    setSelectedId(id);
    setPlaceMode(true);
  };

  return (
    <>
      <div className={`scene-overlay ${placeMode ? "place-on" : ""}`}>
        <Canvas
          camera={{ position: [0, 1.5, 8], fov: 40 }}
          gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
          onCreated={({ gl, scene }) => {
            gl.setClearColor(0x000000, 0);
            scene.background = null;
          }}
          style={{
            width: "100%",
            height: "100%",
            background: "transparent",
            pointerEvents: placeMode ? "auto" : "none",
          }}
          onPointerMissed={() => setSelectedId(null)}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[4, 6, 3]} intensity={1.15} />
          <SceneReporter props={visibleProps} followDom={followDom} />
          {visibleProps.map((p) => {
            const hasModel = Boolean(manifest.models[p.model]);
            if (hasModel) {
              const path = manifest.models[p.model];
              if (!path) return null;
              return (
                <Suspense key={p.id} fallback={null}>
                  <AnchoredProp
                    prop={p}
                    path={path}
                    followDom={followDom}
                    selected={selectedId === p.id}
                    onSelect={() => setSelectedId(p.id)}
                  />
                </Suspense>
              );
            }
            if (p.media) {
              return (
                <Suspense key={p.id} fallback={null}>
                  <AnchoredBillboard
                    prop={p}
                    src={assetUrl(p.media.src)}
                    kind={p.media.kind}
                    followDom={followDom}
                  />
                </Suspense>
              );
            }
            if (p.text) {
              return (
                <AnchoredKaoText
                  key={p.id}
                  prop={p}
                  text={p.text}
                  followDom={followDom}
                />
              );
            }
            return null;
          })}
          {placeMode ? (
            <Suspense fallback={null}>
              <ContactShadows opacity={0.25} scale={20} blur={2.5} far={8} />
            </Suspense>
          ) : null}
          {placeMode ? <OrbitControls makeDefault /> : null}
        </Canvas>
      </div>

      {placeMode ? (
        <div className="place-hud">
          <button
            type="button"
            className="on"
            onClick={() => setPlaceMode(false)}
          >
            Place mode ON
          </button>
          <select
            value={addModel}
            onChange={(e) => setAddModel(e.target.value)}
          >
            {MODEL_LIBRARY.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" onClick={addProp}>
            Add prop
          </button>
          <button type="button" onClick={exportManifest}>
            Export manifest
          </button>
          <span>
            {selected
              ? `${selected.id} · arrows move · [ ] scale · , . rotate`
              : "select a prop · npm run place:verify"}
          </span>
        </div>
      ) : (
        <div className="place-hud mode-hint" role="status">
          <span>
            <kbd>↑↓←→</kbd> move
          </span>
          <span className="mode-hint-sep" aria-hidden="true">
            ·
          </span>
          <span className="mode-hint-rotate">
            <kbd>[</kbd> <kbd>]</kbd> depth
          </span>
          <span className="mode-hint-sep" aria-hidden="true">
            ·
          </span>
          <span className="mode-hint-rotate">
            <kbd>i</kbd> <kbd>k</kbd> pitch · <kbd>u</kbd> <kbd>o</kbd> yaw ·{" "}
            <kbd>,</kbd> <kbd>.</kbd> roll
          </span>
          <span className="mode-hint-sep" aria-hidden="true">
            ·
          </span>
          <span className="mode-hint-rotate">
            <kbd>shift</kbd>-drag / scroll axes
          </span>
        </div>
      )}
    </>
  );
}
