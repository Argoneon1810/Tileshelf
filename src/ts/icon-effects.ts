// 아이콘 비파괴 효과 스택(배경색 정밀 제거 · 여백 재단 · 연속 등면적 광학 보정 · 다크모드 대비 보정) 처리기.
// 원본 비트맵은 그대로 보존하고 런타임에 현재 테마(dark/light)에 맞춰 합성하며, 메모리 캐시로 재계산을 피한다.

export type ThemeAdaptPolicy = 'none' | 'auto' | 'luma-lift' | 'invert-mark' | 'keyline';

export interface IconEffects {
  enabled: boolean;
  bgRemove: boolean;
  trimAlpha: boolean;
  opticalSize: boolean;
  themeAdapt: ThemeAdaptPolicy;
}

export interface IconAnalysis {
  shouldRemoveOuterBg: boolean;
  isAchromaticBg: boolean;
  isMeaningfulChromaticBadge: boolean;
  alreadyFullBleed: boolean;
  emptyMarginRatio: number;
  fillRatio: number;
  opticalFactor: number;
  asymmetryPx: number;
  clashesWithDarkTheme: boolean;
  appliedThemeAdapt: ThemeAdaptPolicy | 'none';
  recommended: boolean;
}

export interface ProcessedIconPixels extends IconAnalysis {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  resampled: boolean;
}

const VALID_POLICIES = new Set<ThemeAdaptPolicy>(['none', 'auto', 'luma-lift', 'invert-mark', 'keyline']);

export function sanitizeIconEffects(raw: unknown): IconEffects | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return undefined;
  const policy = VALID_POLICIES.has(obj.themeAdapt as ThemeAdaptPolicy) ? (obj.themeAdapt as ThemeAdaptPolicy) : 'auto';
  return {
    enabled: obj.enabled,
    bgRemove: typeof obj.bgRemove === 'boolean' ? obj.bgRemove : true,
    trimAlpha: typeof obj.trimAlpha === 'boolean' ? obj.trimAlpha : true,
    opticalSize: typeof obj.opticalSize === 'boolean' ? obj.opticalSize : true,
    themeAdapt: policy,
  };
}

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

function relLuminance(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 배경색(bgR, bgG, bgB) 대비 현재 픽셀(r, g, b)이 가질 수 있는 최소 고유 불투명도(Channel-wise Color-to-Alpha).
// 노랑(251,188,5)처럼 밝은 원색도 B=5 채널 덕분에 고유 알파가 0.98로 계산되어 반투명 픽셀로 오판되지 않는다.
export function intrinsicAlphaAgainstBg(r: number, g: number, b: number, bgR: number, bgG: number, bgB: number): number {
  const ar = r < bgR ? (bgR - r) / Math.max(1, bgR) : r > bgR ? (r - bgR) / Math.max(1, 255 - bgR) : 0;
  const ag = g < bgG ? (bgG - g) / Math.max(1, bgG) : g > bgG ? (g - bgG) / Math.max(1, 255 - bgG) : 0;
  const ab = b < bgB ? (bgB - b) / Math.max(1, bgB) : b > bgB ? (b - bgB) / Math.max(1, 255 - bgB) : 0;
  return Math.max(ar, ag, ab);
}

// 순수 RGBA 버퍼에서 비파괴 정제 파이프라인을 수행한다 (DOM 없이 Node 단위 시험 가능).
export function processIconPixels(
  srcRgba: Uint8ClampedArray,
  W: number,
  H: number,
  {
    removeBg = true,
    trimAlpha = true,
    opticalSize = true,
    themeAdapt = 'auto' as ThemeAdaptPolicy,
    currentTheme = 'dark' as 'dark' | 'light',
  } = {},
): ProcessedIconPixels {
  const d = new Uint8ClampedArray(srcRgba);
  const orig = new Uint8ClampedArray(srcRgba);

  // [Gate 1: 캔버스 외곽 테두리 알파 게이트]
  // 이미 외곽 배경이 투명(알파)인 아이콘은 절대 배경 제거 대상이 아니다.
  const borderIdx: number[] = [];
  for (let x = 0; x < W; x++) borderIdx.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) borderIdx.push(y * W, y * W + (W - 1));

  const corners = [0, W - 1, (H - 1) * W, (H - 1) * W + (W - 1)];
  let cornerR = 0;
  let cornerG = 0;
  let cornerB = 0;
  let opaqueCorners = 0;
  for (const cIdx of corners) {
    if (d[cIdx * 4 + 3] >= 240) {
      cornerR += d[cIdx * 4];
      cornerG += d[cIdx * 4 + 1];
      cornerB += d[cIdx * 4 + 2];
      opaqueCorners++;
    }
  }

  let hasSolidOuterBg = false;
  let bgR = 255;
  let bgG = 255;
  let bgB = 255;

  if (opaqueCorners >= 3) {
    bgR = Math.round(cornerR / opaqueCorners);
    bgG = Math.round(cornerG / opaqueCorners);
    bgB = Math.round(cornerB / opaqueCorners);

    let matchingBorder = 0;
    for (const bIdx of borderIdx) {
      if (d[bIdx * 4 + 3] >= 240) {
        const dist = colorDist(d[bIdx * 4], d[bIdx * 4 + 1], d[bIdx * 4 + 2], bgR, bgG, bgB);
        if (dist <= 22) matchingBorder++;
      }
    }
    if (matchingBorder / borderIdx.length >= 0.78) {
      hasSolidOuterBg = true;
    }
  }

  const bgChroma = Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB);
  const isAchromaticBg = bgChroma <= 18;

  // 외곽 테두리에서 시작하는 8방향 Flood Fill (고유 알파 <= 0.14인 배경·JPEG 링잉·호 사이 빈틈 관통)
  const bgAlphaTol = 0.14;
  const bgMask = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qHead = 0;
  let qTail = 0;

  if (hasSolidOuterBg) {
    for (const bIdx of borderIdx) {
      if (bgMask[bIdx]) continue;
      const ia = intrinsicAlphaAgainstBg(d[bIdx * 4], d[bIdx * 4 + 1], d[bIdx * 4 + 2], bgR, bgG, bgB);
      if (d[bIdx * 4 + 3] < 20 || ia <= bgAlphaTol) {
        bgMask[bIdx] = 1;
        queue[qTail++] = bIdx;
      }
    }
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const;
    while (qHead < qTail) {
      const cur = queue[qHead++];
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const nb = ny * W + nx;
        if (bgMask[nb]) continue;
        const ia = intrinsicAlphaAgainstBg(d[nb * 4], d[nb * 4 + 1], d[nb * 4 + 2], bgR, bgG, bgB);
        if (ia <= bgAlphaTol) {
          bgMask[nb] = 1;
          queue[qTail++] = nb;
        }
      }
    }
  }

  // [Gate 2: 침식된 내부 코어 채도 기반 배지 보호 가드]
  let fgCount = 0;
  let coreFgCount = 0;
  let coreFgChromaSum = 0;
  let totalOpaque = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (d[i * 4 + 3] >= 180) totalOpaque++;
      if (!bgMask[i] && d[i * 4 + 3] >= 180) {
        fgCount++;
        if (!bgMask[i - 1] && !bgMask[i + 1] && !bgMask[i - W] && !bgMask[i + W]) {
          const r = d[i * 4];
          const g = d[i * 4 + 1];
          const b = d[i * 4 + 2];
          coreFgCount++;
          coreFgChromaSum += Math.max(r, g, b) - Math.min(r, g, b);
        }
      }
    }
  }
  const avgCoreChroma = coreFgCount > 0 ? coreFgChromaSum / coreFgCount : 0;
  const fgAreaRatio = fgCount / Math.max(1, totalOpaque);

  const isMeaningfulChromaticBadge = hasSolidOuterBg && !isAchromaticBg && avgCoreChroma <= 28;
  const shouldRemoveOuterBg =
    hasSolidOuterBg && !isMeaningfulChromaticBadge && fgAreaRatio >= 0.06 && fgAreaRatio <= 0.8;

  if (removeBg && shouldRemoveOuterBg) {
    // 형태학적 1px 고립 부스러기(JPEG 모기 노이즈) 흡수
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const idx = y * W + x;
          if (bgMask[idx]) continue;
          let bgN = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (bgMask[(y + dy) * W + (x + dx)]) bgN++;
            }
          }
          if (bgN >= 6) bgMask[idx] = 1;
        }
      }
    }

    for (let i = 0; i < W * H; i++) {
      if (bgMask[i]) d[i * 4 + 3] = 0;
    }

    // [2px 경계 공선성(Collinear) + 3채널 단조성 언믹싱]:
    // 안티앨리어싱 경계는 곡선에서 최대 2px 두께로 형성되므로 반경 2px까지 검사하되,
    // 이웃 픽셀 Q가 현재 픽셀 P와 배경(bg)을 잇는 동일 색상 반직선(cos >= 0.985) 위에 있고
    // R·G·B 모든 채널에서 P가 Q보다 배경색에 더 가까울 때만 배경 혼합 픽셀로 판정해 언믹싱한다.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (bgMask[idx]) continue;

        let minBgDist = 99;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H || bgMask[ny * W + nx]) {
              const cheb = Math.max(Math.abs(dx), Math.abs(dy));
              if (cheb < minBgDist) minBgDist = cheb;
            }
          }
        }
        if (minBgDist > 2) continue;

        const obsR = orig[idx * 4];
        const obsG = orig[idx * 4 + 1];
        const obsB = orig[idx * 4 + 2];
        const vx = obsR - bgR;
        const vy = obsG - bgG;
        const vz = obsB - bgB;
        const vNorm = Math.hypot(vx, vy, vz);
        const ia = intrinsicAlphaAgainstBg(obsR, obsG, obsB, bgR, bgG, bgB);

        if ((minBgDist === 1 && ia <= 0.18) || vNorm < 4) {
          d[idx * 4 + 3] = 0;
          continue;
        }

        let bestNorm = vNorm;
        let coreR = obsR;
        let coreG = obsG;
        let coreB = obsB;
        let foundCore = false;

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nIdx = ny * W + nx;
            if (bgMask[nIdx]) continue;
            const nr = orig[nIdx * 4];
            const ng = orig[nIdx * 4 + 1];
            const nb = orig[nIdx * 4 + 2];
            const nvx = nr - bgR;
            const nvy = ng - bgG;
            const nvz = nb - bgB;
            const nNorm = Math.hypot(nvx, nvy, nvz);
            if (nNorm <= bestNorm + 2) continue;

            if (
              Math.abs(vx) <= Math.abs(nvx) + 3 &&
              Math.abs(vy) <= Math.abs(nvy) + 3 &&
              Math.abs(vz) <= Math.abs(nvz) + 3
            ) {
              const cos = (vx * nvx + vy * nvy + vz * nvz) / (vNorm * nNorm);
              if (cos >= 0.985) {
                bestNorm = nNorm;
                coreR = nr;
                coreG = ng;
                coreB = nb;
                foundCore = true;
              }
            }
          }
        }

        if (foundCore) {
          const alphaCov = Math.min(1, vNorm / bestNorm);
          const floor = minBgDist === 1 ? 0.14 : 0.04;
          if (alphaCov <= floor) {
            d[idx * 4 + 3] = 0;
          } else {
            d[idx * 4] = coreR;
            d[idx * 4 + 1] = coreG;
            d[idx * 4 + 2] = coreB;
            const outAlpha = Math.min(1, (alphaCov - floor) / (1 - floor));
            d[idx * 4 + 3] = Math.round(outAlpha * 255);
          }
        }
      }
    }
  }

  // [배경이 실제로 제거된 아이콘의 다크모드 저대비 판별 및 비파괴 보정 (themeAdapt)]
  let outerPerimCount = 0;
  let outerPerimLumSum = 0;
  let innerBrightCount = 0;
  let totalFgAfter = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = d[i * 4 + 3];
      if (a < 80) continue;
      totalFgAfter++;
      const lum = relLuminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      if (lum > 0.5) innerBrightCount++;
      if (
        d[(i - 1) * 4 + 3] < 40 ||
        d[(i + 1) * 4 + 3] < 40 ||
        d[(i - W) * 4 + 3] < 40 ||
        d[(i + W) * 4 + 3] < 40
      ) {
        outerPerimCount++;
        outerPerimLumSum += lum;
      }
    }
  }
  const outerPerimAvgLum = outerPerimCount > 0 ? outerPerimLumSum / outerPerimCount : 1;
  const hasBrightInnerCutout = totalFgAfter > 0 && innerBrightCount / totalFgAfter >= 0.12;
  const clashesWithDarkTheme =
    removeBg && shouldRemoveOuterBg && outerPerimCount > 0 && outerPerimAvgLum < 0.05;

  let appliedThemeAdapt: ThemeAdaptPolicy | 'none' = 'none';
  const isExplicitAdapt =
    themeAdapt === 'luma-lift' || themeAdapt === 'invert-mark' || themeAdapt === 'keyline';
  if (currentTheme === 'dark' && themeAdapt !== 'none' && (clashesWithDarkTheme || isExplicitAdapt)) {
    const modeToApply =
      themeAdapt === 'auto' ? (hasBrightInnerCutout ? 'invert-mark' : 'luma-lift') : themeAdapt;

    if (modeToApply === 'invert-mark') {
      appliedThemeAdapt = 'invert-mark';
      for (let i = 0; i < W * H; i++) {
        if (d[i * 4 + 3] === 0) continue;
        d[i * 4] = Math.max(25, 255 - d[i * 4]);
        d[i * 4 + 1] = Math.max(29, 255 - d[i * 4 + 1]);
        d[i * 4 + 2] = Math.max(35, 255 - d[i * 4 + 2]);
      }
    } else if (modeToApply === 'luma-lift') {
      appliedThemeAdapt = 'luma-lift';
      for (let i = 0; i < W * H; i++) {
        if (d[i * 4 + 3] === 0) continue;
        const r = d[i * 4];
        const g = d[i * 4 + 1];
        const b = d[i * 4 + 2];
        if (relLuminance(r, g, b) < 0.25) {
          d[i * 4] = Math.min(255, Math.round(68 + r * 1.45));
          d[i * 4 + 1] = Math.min(255, Math.round(112 + g * 1.65));
          d[i * 4 + 2] = Math.min(255, Math.round(158 + b * 1.35));
        }
      }
    } else if (modeToApply === 'keyline') {
      appliedThemeAdapt = 'keyline';
      const snap = new Uint8ClampedArray(d);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const idx = y * W + x;
          if (snap[idx * 4 + 3] > 180) continue;
          let maxNeighborA = 0;
          for (const nb of [idx - 1, idx + 1, idx - W, idx + W]) {
            if (snap[nb * 4 + 3] > maxNeighborA) maxNeighborA = snap[nb * 4 + 3];
          }
          if (maxNeighborA >= 140 && snap[idx * 4 + 3] < 120) {
            d[idx * 4] = 165;
            d[idx * 4 + 1] = 192;
            d[idx * 4 + 2] = 230;
            d[idx * 4 + 3] = Math.max(snap[idx * 4 + 3], 145);
          }
        }
      }
    }
  }

  // 외곽 투명 여백 측정 + 비대칭 무게중심 보정 + 연속 등면적 광학 보정
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  let opaquePx = 0;
  let sumX = 0;
  let sumY = 0;
  let sumWeight = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (a > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (a > 128) opaquePx++;
        sumX += x * a;
        sumY += y * a;
        sumWeight += a;
      }
    }
  }

  const bboxW = maxX >= minX ? maxX - minX + 1 : W;
  const bboxH = maxY >= minY ? maxY - minY + 1 : H;
  const maxSpan = Math.max(bboxW, bboxH);
  const minSpan = Math.max(1, Math.min(bboxW, bboxH));
  const emptyMarginRatio = Math.max(0, 1 - maxSpan / W);

  let silhouetteArea = 0;
  if (maxX >= minX) {
    for (let y = minY; y <= maxY; y++) {
      let rowL = -1;
      let rowR = -1;
      for (let x = minX; x <= maxX; x++) {
        if (d[(y * W + x) * 4 + 3] > 64) {
          if (rowL === -1) rowL = x;
          rowR = x;
        }
      }
      if (rowL !== -1) silhouetteArea += rowR - rowL + 1;
    }
  }
  const silhouetteDensity = Math.max(0.45, Math.min(1, silhouetteArea / Math.max(1, bboxW * bboxH)));
  const aspectRatio = maxSpan / minSpan;
  const fillRatio = opaquePx / Math.max(1, bboxW * bboxH);

  const equalAreaTargetSpan = Math.max(
    0.86,
    Math.min(1.0, 0.88 * (0.95 / silhouetteDensity) ** 0.24 * aspectRatio ** 0.28),
  );
  const opticalFactor = opticalSize ? Number(equalAreaTargetSpan.toFixed(2)) : 0.94;
  const isSquareBadge = silhouetteDensity > 0.88 && aspectRatio < 1.15;

  const bboxCx = (minX + maxX) / 2;
  const bboxCy = (minY + maxY) / 2;
  const massCx = sumWeight > 0 ? sumX / sumWeight : bboxCx;
  const massCy = sumWeight > 0 ? sumY / sumWeight : bboxCy;
  const asymmetryPx = Math.hypot(massCx - bboxCx, massCy - bboxCy);

  const alreadyFullBleed = !shouldRemoveOuterBg && emptyMarginRatio < 0.03 && !opticalSize && asymmetryPx < 1.5;
  const resampled = (trimAlpha || opticalSize) && maxX >= minX && !alreadyFullBleed;

  const baseSpan = trimAlpha ? Math.max(bboxW, bboxH) : W;
  const targetSide = W * (trimAlpha ? opticalFactor : 1.0);
  const scale = targetSide / baseSpan;
  const cropX = trimAlpha && maxX >= minX ? minX : 0;
  const cropY = trimAlpha && maxY >= minY ? minY : 0;
  const cropW = trimAlpha && maxX >= minX ? bboxW : W;
  const cropH = trimAlpha && maxY >= minY ? bboxH : H;
  const drawW = resampled ? cropW * scale : W;
  const drawH = resampled ? cropH * scale : H;
  const shiftX = trimAlpha ? (bboxCx - massCx) * scale * 0.55 : 0;
  const shiftY = trimAlpha ? (bboxCy - massCy) * scale * 0.55 : 0;
  const drawX = resampled ? Math.max(0, Math.min(W - drawW, (W - drawW) / 2 + shiftX)) : 0;
  const drawY = resampled ? Math.max(0, Math.min(H - drawH, (H - drawH) / 2 + shiftY)) : 0;

  return {
    rgba: d,
    width: W,
    height: H,
    cropX,
    cropY,
    cropW,
    cropH,
    drawX,
    drawY,
    drawW,
    drawH,
    resampled,
    shouldRemoveOuterBg,
    isAchromaticBg,
    isMeaningfulChromaticBadge,
    alreadyFullBleed,
    emptyMarginRatio,
    fillRatio,
    opticalFactor,
    asymmetryPx,
    clashesWithDarkTheme,
    appliedThemeAdapt,
    recommended: shouldRemoveOuterBg || emptyMarginRatio >= 0.08 || isSquareBadge || asymmetryPx >= 1.8,
  };
}

// ---- 브라우저 Canvas 합성 및 메모리 렌더 캐시 ----

const renderCache = new Map<string, string>();

export function clearIconRenderCache(): void {
  renderCache.clear();
}

// 픽셀을 읽을 수 있는 그림인가. 사용자가 직접 고른 아이콘(data:/blob:)만 해당한다.
// 바깥 서버(Google 파비콘 등)의 그림은 화면에 그릴 수는 있어도, 서버가 CORS 허가 헤더를 보내지 않아
// 픽셀을 읽으려 하면 Chrome이 막고 확장 오류 목록에 오류를 남긴다. 그래서 아예 시도하지 않는다(1.2.1).
export function canReadIconPixels(src: string): boolean {
  return /^(data|blob):/i.test(src);
}

function loadSourceImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('icon load failed'));
    img.src = src;
  });
}

export function renderCanvasFromProcessed(proc: ProcessedIconPixels, outType = 'image/png', quality?: number): string {
  const { width: W, height: H } = proc;
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  const wCtx = work.getContext('2d')!;
  wCtx.putImageData(new ImageData(new Uint8ClampedArray(proc.rgba), W, H), 0, 0);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const outCtx = out.getContext('2d')!;
  outCtx.imageSmoothingQuality = 'high';

  if (proc.resampled) {
    outCtx.drawImage(work, proc.cropX, proc.cropY, proc.cropW, proc.cropH, proc.drawX, proc.drawY, proc.drawW, proc.drawH);
  } else {
    outCtx.drawImage(work, 0, 0);
  }
  return out.toDataURL(outType, quality);
}

export async function extractIconCanvas(sources: string[], size = 64): Promise<{ canvas: HTMLCanvasElement; rgba: Uint8ClampedArray; dataUrl: string } | null> {
  for (const src of sources) {
    if (!src || !canReadIconPixels(src)) continue;
    try {
      const img = await loadSourceImage(src);
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingQuality = 'high';
      const scale = Math.min(size / Math.max(1, img.naturalWidth || img.width || size), size / Math.max(1, img.naturalHeight || img.height || size));
      const w = (img.naturalWidth || img.width || size) * scale;
      const h = (img.naturalHeight || img.height || size) * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const imgData = ctx.getImageData(0, 0, size, size);
      return { canvas: c, rgba: imgData.data, dataUrl: c.toDataURL('image/webp', 0.9) };
    } catch {
      /* 그림이 깨져 불러오지 못하면 다음 후보로 넘어간다 */
    }
  }
  return null;
}

export async function renderIconWithEffects(
  cacheId: string,
  sources: string[],
  effects: IconEffects,
  currentTheme: 'dark' | 'light',
  outType = 'image/png',
  quality?: number,
): Promise<string | null> {
  const src0 = sources[0] ?? '';
  const srcSig = `${src0.length}:${src0.slice(-48)}`;
  const key = `${cacheId}|${srcSig}|${effects.bgRemove ? 1 : 0}${effects.trimAlpha ? 1 : 0}${effects.opticalSize ? 1 : 0}${effects.themeAdapt}|${currentTheme}|${outType}`;
  const hit = renderCache.get(key);
  if (hit) return hit;

  const extracted = await extractIconCanvas(sources, 64);
  if (!extracted) return null;

  const proc = processIconPixels(extracted.rgba, 64, 64, {
    removeBg: effects.bgRemove,
    trimAlpha: effects.trimAlpha,
    opticalSize: effects.opticalSize,
    themeAdapt: effects.themeAdapt,
    currentTheme,
  });
  const url = renderCanvasFromProcessed(proc, outType, quality);
  renderCache.set(key, url);
  return url;
}
