// Battle-screen detector v1. Read-only: it never sends taps or swipes.
// Templates were cropped from the user's 712x1600 reference screenshots.
const REFERENCE_WIDTH = 712;
const REFERENCE_HEIGHT = 1600;
const PATCHES = [
  { name: "battlefield", path: "templates/battlefield.png", x: 248, y: 756, w: 227, h: 306 },
  { name: "attack-menu", path: "templates/attack-menu.png", x: 155, y: 1305, w: 397, h: 110 }
];

function pixelData(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 64, 64);
  return ctx.getImageData(0, 0, 64, 64).data;
}

function similarity(a, b) {
  let difference = 0;
  for (let i = 0; i < a.length; i += 4) {
    // Grayscale is less sensitive to animation colours and lighting.
    const aGray = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const bGray = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    difference += Math.abs(aGray - bGray);
  }
  return Math.max(0, 100 * (1 - difference / (64 * 64 * 255)));
}

export async function createBattleDetector(screenImage, report) {
  const templates = await Promise.all(PATCHES.map(async patch => {
    // Vite resolves the public files at the deployed site's base path.
    const response = await fetch(`${import.meta.env.BASE_URL}${patch.path}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Template unavailable: ${patch.path} (${response.status})`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const data = pixelData(bitmap, 0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return { ...patch, data };
  }));

  return function detect() {
    if (!screenImage.complete || !screenImage.naturalWidth) {
      report("Detector: capture a screenshot first");
      return null;
    }
    const results = templates.map(patch => {
      const sx = patch.x / REFERENCE_WIDTH * screenImage.naturalWidth;
      const sy = patch.y / REFERENCE_HEIGHT * screenImage.naturalHeight;
      const sw = patch.w / REFERENCE_WIDTH * screenImage.naturalWidth;
      const sh = patch.h / REFERENCE_HEIGHT * screenImage.naturalHeight;
      const sample = pixelData(screenImage, sx, sy, sw, sh);
      return { name: patch.name, score: similarity(sample, patch.data) };
    });
    const best = [...results].sort((a, b) => b.score - a.score)[0];
    // Conservative initial threshold; tune only after collecting real scores.
    const state = best.score >= 84 ? best.name : "unknown";
    report(`Detector: ${state} | ${results.map(r => `${r.name} ${r.score.toFixed(1)}%`).join(" | ")}`);
    return { state, results };
  };
}
