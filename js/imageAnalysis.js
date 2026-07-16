/* ==========================================================================
   imageAnalysis.js
   Browser-side heuristic scoring derived from image pixels. The goal is not
   perfect computer vision; it is a differentiated, stable creative audit that
   uses measurable composition signals instead of placeholder scores.
   ========================================================================== */

const ImageAnalysis = (() => {
  const WORK_SIZE = 480;
  const GRID_ROWS = 4;
  const GRID_COLS = 4;

  function extractMetrics(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, WORK_SIZE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);

    const lum = new Float32Array(cw * ch);
    const histogram = new Uint32Array(256);
    const colorBuckets = new Map();
    let satSum = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[p] = l;
      histogram[Math.round(l)]++;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      satSum += sat;

      const key = `${r >> 6}-${g >> 6}-${b >> 6}`;
      colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
    }

    const totalPixels = cw * ch;
    const avgSaturation = satSum / totalPixels;

    let mean = 0;
    for (let i = 0; i < lum.length; i++) mean += lum[i];
    mean /= lum.length;

    let variance = 0;
    for (let i = 0; i < lum.length; i++) variance += (lum[i] - mean) ** 2;
    variance /= lum.length;
    const stddev = Math.sqrt(variance);

    const edge = new Float32Array(cw * ch);
    let edgeSum = 0;
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const idx = y * cw + x;
        const gx = lum[idx - 1] - lum[idx + 1];
        const gy = lum[idx - cw] - lum[idx + cw];
        const mag = Math.sqrt(gx * gx + gy * gy);
        edge[idx] = mag;
        edgeSum += mag;
      }
    }
    const avgEdge = edgeSum / totalPixels;

    const TEXT_EDGE_THRESHOLD = 60;
    const FLAT_THRESHOLD = 8;
    let sharpCount = 0;
    let flatCount = 0;
    let hotPixelCount = 0;

    for (let i = 0; i < edge.length; i++) {
      if (edge[i] > TEXT_EDGE_THRESHOLD) sharpCount++;
      if (edge[i] < FLAT_THRESHOLD) flatCount++;
      if (edge[i] > avgEdge * 1.9) hotPixelCount++;
    }

    const textDensity = sharpCount / totalPixels;
    const flatRatio = flatCount / totalPixels;
    const hotSpotCoverage = hotPixelCount / totalPixels;

    const grid = buildRegionGrid(lum, edge, cw, ch, GRID_ROWS, GRID_COLS);
    const edgeSummary = summarizeGrid(grid);
    const distinctColors = colorBuckets.size;
    const dominantColorShare = Math.max(...colorBuckets.values(), 1) / totalPixels;
    const dynamicRange = (
      percentileFromHistogram(histogram, totalPixels, 0.9) -
      percentileFromHistogram(histogram, totalPixels, 0.1)
    ) / 255;

    const zoneAverages = {
      top: rectMean(edge, cw, ch, 0, 1, 0, 0.32),
      middle: rectMean(edge, cw, ch, 0, 1, 0.32, 0.68),
      bottom: rectMean(edge, cw, ch, 0, 1, 0.68, 1),
      topCenter: rectMean(edge, cw, ch, 0.22, 0.78, 0, 0.36),
      center: rectMean(edge, cw, ch, 0.24, 0.76, 0.24, 0.76),
      bottomCenter: rectMean(edge, cw, ch, 0.3, 0.7, 0.64, 1),
      bottomSides: (
        rectMean(edge, cw, ch, 0, 0.24, 0.64, 1) +
        rectMean(edge, cw, ch, 0.76, 1, 0.64, 1)
      ) / 2,
      left: rectMean(edge, cw, ch, 0, 0.33, 0, 1),
      right: rectMean(edge, cw, ch, 0.67, 1, 0, 1),
      topLeft: rectMean(edge, cw, ch, 0, 0.2, 0, 0.2),
      topRight: rectMean(edge, cw, ch, 0.8, 1, 0, 0.2),
      bottomLeft: rectMean(edge, cw, ch, 0, 0.2, 0.8, 1),
      bottomRight: rectMean(edge, cw, ch, 0.8, 1, 0.8, 1),
    };

    zoneAverages.topCorners = (zoneAverages.topLeft + zoneAverages.topRight) / 2;
    zoneAverages.bottomCorners = (zoneAverages.bottomLeft + zoneAverages.bottomRight) / 2;

    return {
      width: w,
      height: h,
      cw,
      ch,
      avgSaturation,
      contrastStddev: stddev,
      dynamicRange,
      avgEdge,
      textDensity,
      flatRatio,
      hotSpotCoverage,
      distinctColors,
      dominantColorShare,
      grid,
      ratio: w / h,
      zoneAverages,
      dominance: edgeSummary.dominance,
      edgeEntropy: edgeSummary.entropy,
      edgeCentroid: computeEdgeCentroid(edge, cw, ch),
      lateralBalance: edgeSummary.lateralBalance,
      safeZoneActivity: computeSafeZoneActivity(edge, cw, ch, avgEdge),
    };
  }

  function buildRegionGrid(lum, edge, cw, ch, rows, cols) {
    const cells = [];
    const cellW = cw / cols;
    const cellH = ch / rows;

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cellW);
        const x1 = Math.floor((c + 1) * cellW);
        const y0 = Math.floor(r * cellH);
        const y1 = Math.floor((r + 1) * cellH);
        let lumSum = 0;
        let edgeSum = 0;
        let n = 0;

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = y * cw + x;
            lumSum += lum[idx];
            edgeSum += edge[idx];
            n++;
          }
        }

        row.push({
          meanLum: n ? lumSum / n : 0,
          meanEdge: n ? edgeSum / n : 0,
        });
      }
      cells.push(row);
    }

    return cells;
  }

  function summarizeGrid(grid) {
    const values = grid.flat().map((cell) => cell.meanEdge);
    const maxEdge = Math.max(...values, 0.001);
    const sum = values.reduce((acc, value) => acc + value, 0);
    const mean = sum / values.length;
    const dominance = maxEdge / (mean + 0.001);
    const entropy = normalizedEntropy(values);

    const cols = grid[0].length;
    let left = 0;
    let right = 0;
    values.forEach((value, idx) => {
      const col = idx % cols;
      if (col < cols / 2) left += value;
      else right += value;
    });

    return {
      dominance,
      entropy,
      lateralBalance: 1 - Math.abs(left - right) / (left + right + 0.001),
    };
  }

  function percentileFromHistogram(histogram, totalPixels, percentile) {
    const threshold = totalPixels * percentile;
    let cumulative = 0;
    for (let i = 0; i < histogram.length; i++) {
      cumulative += histogram[i];
      if (cumulative >= threshold) return i;
    }
    return 255;
  }

  function rectMean(edge, cw, ch, left, right, top, bottom) {
    const x0 = Math.max(0, Math.floor(left * cw));
    const x1 = Math.min(cw, Math.ceil(right * cw));
    const y0 = Math.max(0, Math.floor(top * ch));
    const y1 = Math.min(ch, Math.ceil(bottom * ch));
    let sum = 0;
    let count = 0;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += edge[y * cw + x];
        count++;
      }
    }

    return count ? sum / count : 0;
  }

  function normalizedEntropy(values) {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) return 1;

    let entropy = 0;
    values.forEach((value) => {
      if (!value) return;
      const p = value / total;
      entropy -= p * Math.log2(p);
    });

    return entropy / Math.log2(values.length);
  }

  function computeEdgeCentroid(edge, cw, ch) {
    let sum = 0;
    let xSum = 0;
    let ySum = 0;

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const weight = edge[y * cw + x];
        sum += weight;
        xSum += x * weight;
        ySum += y * weight;
      }
    }

    if (!sum) {
      return { x: 0.5, y: 0.5 };
    }

    return {
      x: xSum / sum / cw,
      y: ySum / sum / ch,
    };
  }

  function computeSafeZoneActivity(edge, cw, ch, avgEdge) {
    const result = {};
    const denominator = avgEdge + 0.001;

    Object.entries(AppConfig.SAFE_ZONES).forEach(([platform, zone]) => {
      const top = rectMean(edge, cw, ch, 0, 1, 0, zone.top);
      const bottom = rectMean(edge, cw, ch, 0, 1, 1 - zone.bottom, 1);
      const left = rectMean(edge, cw, ch, 0, zone.left, zone.top, 1 - zone.bottom);
      const right = rectMean(edge, cw, ch, 1 - zone.right, 1, zone.top, 1 - zone.bottom);
      const unsafeMean = (top + bottom + left + right) / 4;
      result[platform] = clamp(unsafeMean / denominator / 1.15, 0, 1);
    });

    return result;
  }

  function classifyAspectRatio(ratio) {
    const ratios = AppConfig.PLATFORM_RATIOS;
    const placementSpecs = AppConfig.PLACEMENT_SPECS;
    let closest = null;
    let closestDiff = Infinity;

    Object.keys(ratios).forEach((key) => {
      const diff = Math.abs(ratio - ratios[key].ratio);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = key;
      }
    });

    const compatibility = {};
    Object.entries(placementSpecs).forEach(([key, spec]) => {
      compatibility[key] = spec.ratios.some((targetRatio) => Math.abs(ratio - targetRatio) < spec.tolerance);
    });

    return {
      ratioValue: ratio,
      nearest: ratios[closest].label,
      exactMatch: closestDiff < 0.025,
      matchStrength: clamp(1 - closestDiff / 0.14, 0, 1),
      compatibility,
      standardizedSizes: Object.fromEntries(
        Object.entries(placementSpecs).map(([key, spec]) => [key, spec.standardizedSize])
      ),
    };
  }

  function scoreHeuristically(m) {
    const cat = {};
    const PIXEL_CAVEAT = ' (pixel-based estimate - semantic claims are inferred from composition, not OCR-perfect reading)';
    const contrastNorm = clamp((m.contrastStddev / 72) * 0.65 + m.dynamicRange * 0.5, 0, 1);
    const busyPenalty = clamp((m.textDensity - 0.06) / 0.16, 0, 1);
    const focus = clamp(((m.dominance - 1) / 1.2) * 0.55 + (1 - m.edgeEntropy) * 0.45, 0, 1);
    const centerDistance = Math.hypot(m.edgeCentroid.x - 0.5, m.edgeCentroid.y - 0.5);
    const centeredness = 1 - clamp(centerDistance / 0.45, 0, 1);
    const topRatio = m.zoneAverages.top / (m.avgEdge + 0.001);
    const topCenterRatio = m.zoneAverages.topCenter / (m.avgEdge + 0.001);
    const centerRatio = m.zoneAverages.center / (m.avgEdge + 0.001);
    const bottomCenterRatio = m.zoneAverages.bottomCenter / (m.avgEdge + 0.001);
    const cornerRatio = Math.max(
      m.zoneAverages.topLeft,
      m.zoneAverages.topRight,
      m.zoneAverages.bottomLeft,
      m.zoneAverages.bottomRight
    ) / (m.avgEdge + 0.001);

    cat.contrast = {
      score: round(contrastNorm * 5),
      reason: contrastNorm > 0.72
        ? 'Strong tonal separation and usable dynamic range make the key elements stand apart from the background.'
        : contrastNorm > 0.46
          ? 'Moderate contrast. The frame is readable, but some important elements likely blend at mobile-scroll size.'
          : 'Low contrast and compressed tonal range flatten the frame, so key elements will struggle to pop.',
      recommendation: contrastNorm > 0.72
        ? 'Keep this contrast profile in future variants.'
        : 'Increase local contrast around the headline, product, or CTA by darkening the backdrop or adding a scrim.',
    };

    const readabilityRaw = clamp(contrastNorm * 0.45 + (1 - busyPenalty) * 0.35 + focus * 0.2, 0, 1);
    cat.readability = {
      score: round(readabilityRaw * 10),
      reason: readabilityRaw > 0.72
        ? 'The frame should scan quickly on a phone: contrast is solid, clutter is controlled, and attention is not overly fragmented.'
        : readabilityRaw > 0.45
          ? 'Readable, but not frictionless. Either clutter, low contrast, or too many competing hotspots slow comprehension.'
          : 'This composition is likely hard to parse at thumb-scroll speed because it is both busy and low in separation.',
      recommendation: 'Reduce competing details, increase spacing around the primary message, and give text or CTA a clearer backing shape.',
    };

    const idealFlat = 0.5;
    const whitespaceRaw = clamp(
      1 - Math.abs(m.flatRatio - idealFlat) / idealFlat * 0.75 - busyPenalty * 0.2,
      0,
      1
    );
    cat.whitespace = {
      score: round(whitespaceRaw * 10),
      reason: whitespaceRaw > 0.68
        ? 'Breathing room is in a healthy range: the frame feels designed rather than crowded or empty.'
        : m.flatRatio < idealFlat - 0.15
          ? 'The frame is dense edge-to-edge, leaving very little negative space to help the eye prioritize.'
          : 'A large portion of the frame is visually quiet, which risks making the creative feel under-built or low-energy.',
      recommendation: m.flatRatio < idealFlat - 0.15
        ? 'Strip back at least one secondary element and increase padding around the main subject.'
        : 'Use empty space more deliberately by tightening the composition around the strongest element.',
    };

    const hierarchyRaw = clamp(focus * 0.7 + m.lateralBalance * 0.15 + centeredness * 0.15, 0, 1);
    cat.visual_hierarchy = {
      score: round(hierarchyRaw * 15),
      reason: hierarchyRaw > 0.68
        ? 'There is a clear focal order: one area dominates, and the rest of the frame supports it.'
        : hierarchyRaw > 0.4
          ? 'A focal point exists, but several other active regions still compete for first attention.'
          : 'Visual weight is spread too evenly, so the eye is not told where to land first.',
      recommendation: 'Amplify one primary focal point through scale, isolation, and contrast, then quiet surrounding regions.',
    };

    const hookRaw = clamp(topRatio * 0.55 + topCenterRatio * 0.25 + contrastNorm * 0.2 - busyPenalty * 0.15, 0, 1);
    cat.hook_visibility = {
      score: round(hookRaw * 15),
      reason: hookRaw > 0.68
        ? 'The upper portion of the ad carries enough visual energy to earn the first glance in-feed.'
        : hookRaw > 0.4
          ? 'There is some activity in the opening scan zone, but it may not be strong enough to consistently stop a scroll.'
          : 'The top of the frame is comparatively quiet, so the ad likely asks the viewer to work too hard before the value appears.',
      recommendation: 'Move your strongest claim, product cue, or contrast pop into the top 35% to 40% of the frame.',
    };

    const productRaw = clamp(centerRatio * 0.45 + centeredness * 0.3 + focus * 0.25, 0, 1);
    cat.product_focus = {
      score: round(productRaw * 10),
      reason: productRaw > 0.66
        ? 'The hero subject is visually established and sits where viewers naturally expect to find it.'
        : productRaw > 0.38
          ? 'The center carries some weight, but the subject does not fully dominate against nearby distractions.'
          : 'The likely product zone is under-emphasized, making the creative feel more decorative than product-led.',
      recommendation: 'Increase subject scale, simplify the background, or isolate the product with cleaner space around it.',
    };

    const ctaRaw = clamp((bottomCenterRatio - (m.zoneAverages.bottomSides / (m.avgEdge + 0.001))) * 0.65 + contrastNorm * 0.35 + 0.25, 0, 1);
    cat.cta_visibility = {
      score: round(ctaRaw * 10),
      reason: ctaRaw > 0.66
        ? 'A lower-frame action zone stands apart clearly enough to read like a CTA destination.'
        : ctaRaw > 0.38
          ? 'There is some lower-third emphasis, but it is not isolated enough to feel strongly tappable.'
          : 'No clearly isolated CTA zone surfaced in the lower third, so the action step is likely getting lost.',
      recommendation: 'Give the CTA a dedicated contrasting shape, keep it in the lower third, and protect it with clear padding.',
    };

    const paletteDiscipline = clamp(1 - (m.distinctColors - 12) / 26, 0, 1);
    const brandRaw = clamp(
      paletteDiscipline * 0.4 +
      clamp(m.dominantColorShare * 2.4, 0, 1) * 0.25 +
      clamp(cornerRatio / 1.4, 0, 1) * 0.35,
      0,
      1
    );
    cat.brand_presence = {
      score: round(brandRaw * 5),
      reason: brandRaw > 0.66
        ? 'The composition suggests consistent brand control through disciplined palette use and a likely corner brand anchor.'
        : brandRaw > 0.36
          ? 'There are some brand cues, but they are not strongly reinforced by palette consistency or a clear mark location.'
          : 'Brand cues appear weak or visually unstructured. Recall may suffer if the ad wins attention but not attribution.' + PIXEL_CAVEAT,
      recommendation: 'Use one consistent brand color family and keep a small but deliberate logo or wordmark anchored in a corner.',
    };

    const vividness = clamp(m.avgSaturation * 1.1 + contrastNorm * 0.2 + focus * 0.15, 0, 1);
    cat.emotional_appeal = {
      score: round(vividness * 5),
      reason: vividness > 0.64
        ? 'The color and focal energy create an immediately lively, attention-seeking impression.'
        : vividness > 0.34
          ? 'The frame has some visual energy, but it is not especially vivid or emotionally charged.'
          : 'The palette and contrast feel restrained enough that the ad risks reading flat unless the brand intentionally wants understated.',
      recommendation: 'Push energy selectively on the hero subject instead of saturating the whole frame.' + PIXEL_CAVEAT,
    };

    const copyPresence = clamp(m.textDensity / 0.11, 0, 1);
    const copyDiscipline = 1 - clamp(Math.abs(m.textDensity - 0.11) / 0.11, 0, 1);
    const offerRaw = clamp(contrastNorm * 0.25 + copyPresence * 0.2 + clamp(topCenterRatio / 1.45, 0, 1) * 0.35 + copyDiscipline * 0.2, 0, 1);
    cat.offer_clarity = {
      score: round(offerRaw * 5),
      reason: offerRaw > 0.66
        ? 'The composition suggests a readable headline or offer block in a place viewers will notice early.'
        : offerRaw > 0.34
          ? 'There are signals of offer copy, but its prominence or clarity likely is not as immediate as it should be.'
          : 'The offer is probably not visually obvious enough. Either the copy block is too weak, too buried, or too fragmented.' + PIXEL_CAVEAT,
      recommendation: 'Put the core benefit, discount, or headline into a compact high-contrast block near the top-center or center-left.',
    };

    const trustRaw = clamp(
      clamp(m.zoneAverages.bottomCorners / (m.avgEdge + 0.001), 0, 1.4) * 0.35 +
      contrastNorm * 0.2 +
      paletteDiscipline * 0.15 +
      (1 - busyPenalty) * 0.3,
      0,
      1
    );
    cat.trust_signals = {
      score: round(trustRaw * 5),
      reason: trustRaw > 0.62
        ? 'The lower support zones show room and structure for badges, proof points, or reassurance elements.'
        : trustRaw > 0.32
          ? 'Some support areas exist, but trust-building cues likely are not prominent enough to reinforce the conversion step.'
          : 'Trust signals appear weak or absent. The frame does not strongly suggest reviews, badges, or reassurance copy near the action zone.' + PIXEL_CAVEAT,
      recommendation: 'Add one compact proof element near the CTA or product: review stars, testimonial count, guarantee, or brand credibility badge.',
    };

    const ratioInfo = classifyAspectRatio(m.ratio);
    const safeZoneRisk = Math.max(
      ratioInfo.compatibility.story ? m.safeZoneActivity.story : 0,
      ratioInfo.compatibility.reels ? m.safeZoneActivity.reels : 0,
      ratioInfo.compatibility.feed ? m.safeZoneActivity.feed * 0.7 : 0
    );
    const platformRaw = clamp(ratioInfo.matchStrength * 0.68 + (1 - safeZoneRisk) * 0.32, 0, 1);
    cat.platform_readiness = {
      score: round(platformRaw * 5),
      reason: ratioInfo.exactMatch
        ? `Matches a standard placement ratio (${ratioInfo.nearest}) and is closer to a reusable master export.`
        : `The ratio (${m.ratio.toFixed(2)}:1) sits between standard placements, so cropping or letterboxing is likely.`,
      recommendation: ratioInfo.compatibility.story || ratioInfo.compatibility.reels
        ? 'Keep one standardized 1080x1920 master for both Story and Reels, then adjust only the safe content area per placement.'
        : `Export a master at ${ratioInfo.standardizedSizes.feed} or ${ratioInfo.standardizedSizes.carousel} instead of relying on auto-crops.`,
    };

    return { categories: cat, ratioInfo, safeZoneRisk };
  }

  function composeResult(metrics, ratioInfo, categoryMap, overrides = {}) {
    const catList = AppConfig.CATEGORIES.map((def) => {
      const source = categoryMap[def.key] || {};
      return {
        key: def.key,
        title: def.title,
        score: clamp(round(source.score ?? 0), 0, def.max),
        max: def.max,
        reason: source.reason || 'No explanation returned.',
        recommendation: source.recommendation || 'No recommendation returned.',
      };
    });

    const overall = clamp(round(catList.reduce((sum, cat) => sum + cat.score, 0)), 0, 100);
    const rating = AppConfig.ratingFor(overall).label;
    const ranked = [...catList].sort((a, b) => (b.score / b.max) - (a.score / a.max));
    const strengths = overrides.strengths || ranked.slice(0, 3).map((cat) => `${cat.title}: ${cat.reason}`);
    const weaknesses = overrides.weaknesses || ranked.slice(-3).reverse().map((cat) => `${cat.title}: ${cat.reason}`);
    const quickFixes = overrides.quick_fixes || [...catList]
      .sort((a, b) => (a.score / a.max) - (b.score / b.max))
      .slice(0, 4)
      .map((cat) => cat.recommendation);
    const improvements = overrides.improvements || [...catList]
      .map((cat) => ({ title: cat.title, pointsLeft: cat.max - cat.score, text: cat.recommendation }))
      .sort((a, b) => b.pointsLeft - a.pointsLeft)
      .filter((cat) => cat.pointsLeft > 0)
      .slice(0, 6)
      .map((cat) => `${cat.text} (+${round(cat.pointsLeft)} pts potential in ${cat.title})`);

    const ctrTiers = ['Low', 'Medium', 'High', 'Very High'];
    const predictedCtr = overrides.predicted_ctr || ctrTiers[clamp(Math.floor(overall / 26), 0, 3)];
    const predictedConversion = overrides.predicted_conversion || ctrTiers[clamp(Math.floor((overall - 5) / 26), 0, 3)];
    const hookScore = catList.find((cat) => cat.key === 'hook_visibility')?.score || 0;
    const thumbStop = clamp(round((hookScore / 15) * 10), 0, 10);
    const summary = overrides.summary || (
      `This creative scores ${overall}/100 (${rating}). ` +
      `${strengths.length ? strengths[0].split(':')[0] : 'Composition'} is the strongest area; ` +
      `${weaknesses.length ? weaknesses[0].split(':')[0] : 'overall polish'} is the biggest opportunity.`
    );

    return {
      mode: overrides.mode || 'heuristic',
      overall_score: overall,
      rating,
      categories: catList,
      summary,
      strengths,
      weaknesses,
      quick_fixes: quickFixes,
      improvements,
      predicted_ctr: predictedCtr,
      predicted_conversion: predictedConversion,
      thumb_stop_rating: overrides.thumb_stop_rating ?? thumbStop,
      meta_text_warning: overrides.meta_text_warning ?? metrics.textDensity > 0.13,
      aspect_ratio: ratioInfo,
      metrics,
      ai_note: overrides.ai_note || '',
    };
  }

  function runHeuristicAnalysis(imgElement) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const metrics = extractMetrics(imgElement);
        const scored = scoreHeuristically(metrics);
        resolve(composeResult(metrics, scored.ratioInfo, scored.categories, { mode: 'heuristic' }));
      }, 30);
    });
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round(v) {
    return Math.round(v * 10) / 10;
  }

  return {
    runHeuristicAnalysis,
    extractMetrics,
    classifyAspectRatio,
    scoreHeuristically,
    composeResult,
  };
})();
