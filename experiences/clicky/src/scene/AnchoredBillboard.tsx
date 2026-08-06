import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  readPropRotateRad,
  seedPropRotationBases,
} from "../lib/propTransform";

const PX_TO_WORLD = 0.0054;

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

type PropLike = {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  visible: boolean;
};

/**
 * Flat 3D plane pinned to a `[data-prop]` DOM box — used for stickers that
 * are video/image media (keeps motion) when a sculpted GLB isn't available.
 */
export function AnchoredBillboard({
  prop,
  src,
  kind,
  followDom,
}: {
  prop: PropLike;
  src: string;
  kind: "image" | "video";
  followDom: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();

  const texture = useMemo(() => {
    if (kind === "video") {
      const video = document.createElement("video");
      video.src = src;
      video.crossOrigin = "anonymous";
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      void video.play().catch(() => {});
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    }
    const loader = new THREE.TextureLoader();
    const tex = loader.load(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [src, kind]);

  useEffect(() => {
    return () => {
      if (texture instanceof THREE.VideoTexture) {
        const v = texture.image as HTMLVideoElement;
        v.pause();
        v.src = "";
        v.load();
      }
      texture.dispose();
    };
  }, [texture]);

  useFrame(() => {
    const g = group.current;
    const m = mesh.current;
    if (!g || !m) return;

    if (!followDom) {
      g.visible = prop.visible;
      g.position.set(prop.position[0], prop.position[1], prop.position[2]);
      g.rotation.set(prop.rotation[0], prop.rotation[1], prop.rotation[2]);
      const image = texture.image as {
        height?: number;
        videoHeight?: number;
        videoWidth?: number;
        width?: number;
      };
      const imageWidth = image.videoWidth ?? image.width ?? 0;
      const imageHeight = image.videoHeight ?? image.height ?? 0;
      const aspect = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1;
      const w = 0.8;
      m.scale.set(w, w / aspect, 1);
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
    const worldW = r.width * PX_TO_WORLD;
    const worldH = r.height * PX_TO_WORLD;

    g.visible = true;
    g.position.copy(world);
    g.rotation.set(
      readPropRotateRad(el, "x", prop.rotation[0]),
      readPropRotateRad(el, "y", prop.rotation[1]),
      readPropRotateRad(el, "z", prop.rotation[2]),
    );
    m.scale.set(worldW, worldH, 1);
  });

  return (
    <group ref={group}>
      <mesh ref={mesh}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Canvas-textured plane for kao faces — avoids drei Text font Suspense hangs. */
export function AnchoredKaoText({
  prop,
  text,
  followDom,
}: {
  prop: PropLike;
  text: string;
  followDom: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#222222";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 10;
      ctx.font = "bold 72px ui-rounded, 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const x = canvas.width / 2;
      const y = canvas.height / 2;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [text]);

  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  useFrame(() => {
    const g = group.current;
    const m = mesh.current;
    if (!g || !m) return;

    if (!followDom) {
      g.visible = prop.visible;
      g.position.set(prop.position[0], prop.position[1], prop.position[2]);
      g.rotation.set(prop.rotation[0], prop.rotation[1], prop.rotation[2]);
      m.scale.set(0.7, 0.35, 1);
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
    const worldW = Math.max(r.width, r.height * 2) * PX_TO_WORLD;
    const worldH = Math.max(r.height, 24) * PX_TO_WORLD;

    g.visible = true;
    g.position.copy(world);
    g.rotation.set(
      readPropRotateRad(el, "x", prop.rotation[0]),
      readPropRotateRad(el, "y", prop.rotation[1]),
      readPropRotateRad(el, "z", prop.rotation[2]),
    );
    m.scale.set(worldW, worldH, 1);
  });

  return (
    <group ref={group}>
      <mesh ref={mesh}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
