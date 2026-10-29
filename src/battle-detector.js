
/*
 * Pokémon Pocket Battle Detector v2
 *
 * Read-only screen classification.
 * Does not tap, swipe or execute game actions.
 */

const REFERENCE_WIDTH = 712;
const REFERENCE_HEIGHT = 1600;

const PATCHES = [
  {
    name: "battlefield",
    path: "templates/battlefield.png",
    x: 248,
    y: 756,
    w: 227,
    h: 306
  },
  {
    name: "attack-reference",
    path: "templates/attack-menu.png",
    x: 155,
    y: 1305,
    w: 397,
    h: 110
  }
];

const SAMPLE_SIZE = 64;

function pixelData(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");

  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  ctx.drawImage(
    source,
    sx, sy, sw, sh,
    0, 0,
    SAMPLE_SIZE,
    SAMPLE_SIZE
  );

  return ctx.getImageData(
    0, 0, SAMPLE_SIZE, SAMPLE_SIZE
  ).data;
}

function similarity(a, b) {
  let difference = 0;

  for (let i = 0; i < a.length; i += 4) {
    const aGray =
      0.299 * a[i] +
      0.587 * a[i + 1] +
      0.114 * a[i + 2];

    const bGray =
      0.299 * b[i] +
      0.587 * b[i + 1] +
      0.114 * b[i + 2];

    difference += Math.abs(aGray - bGray);
  }

  return Math.max(
    0,
    100 * (
      1 - difference /
      (SAMPLE_SIZE * SAMPLE_SIZE * 255)
    )
  );
}

export async function createBattleDetector(
  screenImage,
  report
) {
  const templates = await Promise.all(
    PATCHES.map(async patch => {
      const url =
        `${import.meta.env.BASE_URL}${patch.path}`;

      const response = await fetch(url, {
        cache: "no-cache"
      });

      if (!response.ok) {
        throw new Error(
          `Template unavailable: ${patch.path}`
        );
      }

      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      const data = pixelData(
        bitmap,
        0,
        0,
        bitmap.width,
        bitmap.height
      );

      bitmap.close();

      return {
        ...patch,
        data
      };
    })
  );

  report("Battle detector v2 ready");

  return function detect() {
    if (
      !screenImage.complete ||
      !screenImage.naturalWidth
    ) {
      report("Detector: capture a screenshot first");
      return null;
    }

    const results = templates.map(patch => {
      const sx =
        patch.x / REFERENCE_WIDTH *
        screenImage.naturalWidth;

      const sy =
        patch.y / REFERENCE_HEIGHT *
        screenImage.naturalHeight;

      const sw =
        patch.w / REFERENCE_WIDTH *
        screenImage.naturalWidth;

      const sh =
        patch.h / REFERENCE_HEIGHT *
        screenImage.naturalHeight;

      const sample = pixelData(
        screenImage,
        sx,
        sy,
        sw,
        sh
      );

      return {
        name: patch.name,
        score: similarity(sample, patch.data)
      };
    });

    const battlefield =
      results.find(r => r.name === "battlefield");

    const attack =
      results.find(r => r.name === "attack-reference");

    const battlefieldScore = battlefield.score;
    const attackScore = attack.score;

    let state = "unknown";

    /*
     * Battlefield detection:
     * Require a strong battlefield match and
     * meaningful separation from the attack reference.
     */
    if (
      battlefieldScore >= 84 &&
      battlefieldScore - attackScore >= 8
    ) {
      state = "battlefield";
    }

    /*
     * Card details:
     * The attack reference matches better, but this
     * does not establish that an attack is executable.
     *
     * The lower threshold is provisional and must
     * be tested against other screens.
     */
    else if (
      attackScore >= 72 &&
      attackScore - battlefieldScore >= 10
    ) {
      state = "card-details";
    }

    /*
     * Attack interface:
     * Reserved until we have a separate reference
     * for a confirmed actionable attack button.
     */

    const message =
      `Detector: ${state}` +
      ` | battlefield ${battlefieldScore.toFixed(1)}%` +
      ` | attack-reference ${attackScore.toFixed(1)}%`;

    report(message);

    return {
      state,
      results,
      actionableAttack: false
    };
  };
}
