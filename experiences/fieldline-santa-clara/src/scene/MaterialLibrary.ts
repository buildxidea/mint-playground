import * as THREE from "three";

export class MaterialLibrary {
  readonly concrete = new THREE.MeshStandardMaterial({
    color: 0x484947,
    roughness: 0.94,
    metalness: 0.02,
  });
  readonly concreteDark = new THREE.MeshStandardMaterial({
    color: 0x242726,
    roughness: 0.9,
    metalness: 0.08,
  });
  readonly concreteLight = new THREE.MeshStandardMaterial({
    color: 0x77766f,
    roughness: 0.92,
    metalness: 0.02,
  });
  readonly blackenedSteel = new THREE.MeshStandardMaterial({
    color: 0x121716,
    roughness: 0.38,
    metalness: 0.72,
  });
  readonly burgundy = new THREE.MeshStandardMaterial({
    color: 0x8b1f31,
    roughness: 0.72,
    metalness: 0.04,
  });
  readonly premium = new THREE.MeshStandardMaterial({
    color: 0x3a1921,
    roughness: 0.56,
    metalness: 0.08,
  });
  readonly lime = new THREE.MeshStandardMaterial({
    color: 0xb7e63b,
    emissive: 0x263d08,
    emissiveIntensity: 0.45,
    roughness: 0.55,
  });
  readonly amber = new THREE.MeshStandardMaterial({
    color: 0xe4a553,
    emissive: 0x4b2408,
    emissiveIntensity: 0.28,
    roughness: 0.5,
  });
  readonly glass = new THREE.MeshPhysicalMaterial({
    color: 0x263433,
    roughness: 0.12,
    metalness: 0.18,
    transmission: 0.22,
    transparent: true,
    opacity: 0.84,
  });
  readonly turf = new THREE.MeshStandardMaterial({
    color: 0x34543b,
    roughness: 0.96,
  });
  readonly paintedWhiteSteel = new THREE.MeshStandardMaterial({
    color: 0xd7d8d2,
    roughness: 0.7,
    metalness: 0.34,
  });
  readonly stadiumRed = new THREE.MeshStandardMaterial({
    color: 0x9e1930,
    roughness: 0.68,
    metalness: 0.08,
  });
  readonly greenRoof = new THREE.MeshStandardMaterial({
    color: 0x526a42,
    roughness: 0.98,
    metalness: 0,
  });
  readonly fieldLine = new THREE.MeshBasicMaterial({ color: 0xe7e1d4 });
  readonly shadow = new THREE.MeshBasicMaterial({
    color: 0x050706,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  createFieldMaterial(kind: "football" | "soccer"): THREE.MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (!context) return this.turf.clone();

    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "#31543b");
    gradient.addColorStop(0.5, "#3d6546");
    gradient.addColorStop(1, "#31543b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 20; i += 1) {
      context.fillStyle = i % 2 === 0 ? "rgba(255,255,255,.018)" : "rgba(0,0,0,.025)";
      context.fillRect(0, (i / 20) * canvas.height, canvas.width, canvas.height / 20);
    }

    context.strokeStyle = "rgba(244,239,223,.88)";
    context.fillStyle = "rgba(244,239,223,.88)";
    context.lineWidth = 4;
    context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    if (kind === "football") {
      context.fillStyle = "rgba(92,29,43,.88)";
      context.fillRect(12, 12, canvas.width - 24, 86);
      context.fillRect(12, canvas.height - 98, canvas.width - 24, 86);
      context.strokeStyle = "rgba(244,239,223,.82)";
      context.fillStyle = "rgba(244,239,223,.8)";
      context.lineWidth = 3;
      for (let yard = 1; yard < 20; yard += 1) {
        const y = 12 + (yard / 20) * (canvas.height - 24);
        context.beginPath();
        context.moveTo(12, y);
        context.lineTo(canvas.width - 12, y);
        context.stroke();
        if (yard > 1 && yard < 19) {
          for (let x = 88; x <= canvas.width - 88; x += canvas.width - 176) {
            context.fillRect(x - 2, y - 7, 4, 14);
          }
        }
      }
      context.fillStyle = "rgba(244,239,223,.72)";
      context.font = "600 34px system-ui";
      context.textAlign = "center";
      context.fillText("FIELDLINE", canvas.width / 2, 64);
      context.save();
      context.translate(canvas.width / 2, canvas.height - 64);
      context.rotate(Math.PI);
      context.fillText("FIELDLINE", 0, 0);
      context.restore();
    } else {
      context.beginPath();
      context.arc(canvas.width / 2, canvas.height / 2, 72, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(12, canvas.height / 2);
      context.lineTo(canvas.width - 12, canvas.height / 2);
      context.stroke();
      context.strokeRect(canvas.width / 2 - 126, 12, 252, 150);
      context.strokeRect(canvas.width / 2 - 126, canvas.height - 162, 252, 150);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.93,
      metalness: 0,
    });
  }

  createBoardMaterial(label: string): THREE.MeshBasicMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.MeshBasicMaterial({ color: 0x161c19 });
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#17211f");
    gradient.addColorStop(0.55, "#27342f");
    gradient.addColorStop(1, "#151918");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(183,230,59,.5)";
    context.lineWidth = 2;
    for (let x = 0; x < canvas.width; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    context.fillStyle = "#f0ecdf";
    context.font = "600 76px system-ui";
    context.fillText("FIELDLINE", 72, 150);
    context.fillStyle = "#b7e63b";
    context.font = "500 34px ui-monospace";
    context.fillText(label.toUpperCase(), 76, 220);
    context.fillStyle = "rgba(240,236,223,.62)";
    context.font = "400 25px ui-monospace";
    context.fillText("MODELED VIEW STUDY  •  13:25", 76, 290);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  }
}
