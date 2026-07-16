/* ==========================================================================
   imageAnalysis.js
   Everything here is computed from actual pixels of the uploaded image.
   There is no randomness and no server round-trip. Since pixel analysis
   cannot reliably read offer copy, logos, or trust badges, categories that
   need semantic understanding are scored conservatively and say so clearly.

   Public entry point: ImageAnalysis.runHeuristicAnalysis(imgElement)
   Returns a Promise<AnalysisResult>.
   ========================================================================== */

const ImageAnalysis = (() => {
  const WORK_SIZE = 480;

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
    let satSum = 0;
    const colorBuckets = new Map();

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[p] = l;

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
    let sharpCount = 0;
    for (let i = 0; i < edge.length; i++) {
      if (edge[i] > TEXT_EDGE_THRESHOLD) sharpCount++;
    }
    const textDensity = sharpCount / totalPixels;

    const FLAT_THRESHOLD = 8;
    let flatCount = 0;
    for (let i = 0; i < edge.length; i++) {
      if (edge[i] < FLAT_THRESHOLD) flatCount++;
    }
    const flatRatio = flatCount / totalPixels;

    const grid = buildRegionGrid(lum, edge, cw, ch, 3, 3);
    const distinctColors = colorBuckets.size;

    return {
      width: w,
      height: h,
      cw,
      ch,
      avgSaturation,
      contrastStddev: stddev,
      avgEdge,
      textDensity,
      flatRatio,
      distinctColors,
      grid,
      ratio: w / h,
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

  function classifyAspectRatio(ratio) {
    const specs = AppConfig.PLATFORM_RATIOS;
    let closest = null;
    let closestDiff = Infinity;

    for (const key in specs) {
      const diff = Math.abs(ratio - specs[key].ratio);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = key;
      }
    }

    const tolerance = 0.06;
    const compatibility = {
      feed: Math.abs(ratio - 1) < tolerance || Math.abs(ratio - 4 / 5) < tolerance,
      story: Math.abs(ratio - 9 / 16) < tolerance,
      reels: Math.abs(ratio - 9 / 16) < tolerance,
      carousel: Math.abs(ratio - 1) < tolerance || Math.abs(ratio - 4 / 5) < tolerance,
    };

    return {
      ratioValue: ratio,
      nearest: specs[closest].label,
      exactMatch: closestDiff < tolerance,
      compatibility,
    };
  }

  function scoreHeuristically(m) {
    const cat = {};
    const PIXEL_CAVEAT = ' (pixel-based estimate - text, logos, and offer details are judged conservatively)';

    const contrastNorm = clamp(m.contrastStddev / 70, 0, 1);
    cat.contrast = {
      score: round(contrastNorm * 5),
      reason: contrastNorm > 0.7
        ? 'Strong tonal separation between light and dark regions - elements pop against their background.'
        : contrastNorm > 0.4
          ? 'Moderate tonal contrast. Some elements likely blend into their surroundings.'
          : 'Low tonal contrast across the frame - foreground elements risk disappearing into the background, especially on small mobile screens.',
      recommendation: contrastNorm > 0.7
        ? 'Maintain this contrast range in future creative - it is reading clearly.'
        : 'Push the darkest darks darker and lightest lights lighter, or add a scrim behind text or CTA to separate it from the background.',
    };

    const busyPenalty = clamp(m.textDensity / 0.18, 0, 1);
    const readabilityRaw = contrastNorm * 0.6 + (1 - busyPenalty) * 0.4;
    cat.readability = {
      score: round(readabilityRaw * 10),
      reason: readabilityRaw > 0.7
        ? 'Clean tonal separation and controlled visual density - the frame should read quickly at feed scroll speed.'
        : readabilityRaw > 0.45
          ? 'Readable but not effortless - either contrast or visual density is working against fast scanning.'
          : 'Dense, low-contrast composition. At thumbnail size on a phone this will be hard to parse in the second it gets.',
      recommendation: 'Cut anything that is not the headline, product, or CTA. Increase font weight and size on any on-image text before adding more elements.',
    };

    const idealFlat = 0.55;
    const flatDeviation = Math.abs(m.flatRatio - idealFlat) / idealFlat;
    const whitespaceRaw = clamp(1 - flatDeviation, 0, 1);
    cat.whitespace = {
      score: round(whitespaceRaw * 10),
      reason: m.flatRatio > idealFlat + 0.15
        ? 'A very large share of the frame is visually flat - the creative may feel empty or under-designed.'
        : m.flatRatio < idealFlat - 0.15
          ? 'Very little breathing room - elements are packed edge to edge with no visual rest for the eye.'
          : 'Balanced ratio of active elements to breathing room.',
      recommendation: m.flatRatio < idealFlat - 0.15
        ? 'Remove or consolidate at least one element and increase padding around the headline, product, and CTA.'
        : 'Whitespace balance is solid - keep future variants within this range.',
    };

    const cellEdges = m.grid.flat().map((cell) => cell.meanEdge);
    const maxEdge = Math.max(...cellEdges);
    const meanCellEdge = cellEdges.reduce((a, b) => a + b, 0) / cellEdges.length;
    const dominance = meanCellEdge > 0 ? (maxEdge - meanCellEdge) / (maxEdge + 0.001) : 0;
    const hierarchyRaw = clamp(dominance * 1.4, 0, 1);
    cat.visual_hierarchy = {
      score: round(hierarchyRaw * 15),
      reason: hierarchyRaw > 0.6
        ? 'One clear focal region dominates the composition - the eye has an obvious place to land first.'
        : hierarchyRaw > 0.3
          ? 'A focal point exists but competes with one or two other busy regions.'
          : 'Visual weight is spread evenly across the frame - nothing tells the eye where to look first.',
      recommendation: 'Establish one clear focal point, usually the product or headline, and quiet everything else around it. Size, contrast, and isolation all create hierarchy.',
    };

    const topRow = m.grid[0];
    const topEdge = topRow.reduce((a, cell) => a + cell.meanEdge, 0) / topRow.length;
    const hookRaw = clamp(topEdge / 45, 0, 1);
    cat.hook_visibility = {
      score: round(hookRaw * 15),
      reason: hookRaw > 0.6
        ? 'The upper third of the frame - what a thumb-scrolling viewer sees first - carries strong visual weight.'
        : hookRaw > 0.3
          ? 'The upper third has some visual activity but may not be strong enough to stop a scroll on its own.'
          : 'The top of the frame is visually quiet. In a feed, viewers decide whether to keep scrolling before they reach the middle of the image.',
      recommendation: 'Move your strongest visual or the headline into the top 40% of the frame - that is the zone that earns the scroll-stop.',
    };

    const centerCell = m.grid[1][1];
    const centerRaw = clamp((centerCell.meanEdge / (meanCellEdge + 0.001)) / 2, 0, 1);
    cat.product_focus = {
      score: round(centerRaw * 10),
      reason: centerRaw > 0.6
        ? 'The center of the frame - where product shots typically sit - carries clear visual presence.'
        : centerRaw > 0.3
          ? 'There is some visual weight at center frame, but it is not clearly dominant.'
          : 'The center of the frame is comparatively quiet, which risks burying the product among competing elements.',
      recommendation: 'Increase the product\'s scale relative to the frame, or isolate it against a simpler background so it reads as the obvious subject.',
    };

    const bottomCenter = m.grid[2][1];
    const bottomRow = m.grid[2];
    const bottomAvgExcl = (bottomRow[0].meanEdge + bottomRow[2].meanEdge) / 2;
    const ctaPop = bottomCenter.meanEdge - bottomAvgExcl;
    const ctaRaw = clamp(ctaPop / 25 + 0.3, 0, 1);
    cat.cta_visibility = {
      score: round(ctaRaw * 10),
      reason: ctaRaw > 0.65
        ? 'A distinct, isolated element sits in the lower-center of the frame - consistent with a visible CTA button.'
        : 'No strong, isolated element was detected in the CTA zone. This is a pixel-based estimate, so small CTA text or subtle buttons may still be present.',
      recommendation: 'Place the CTA in the lower third, give it a solid contrasting fill, and keep at least 15 to 20px of clear space around it so it reads as tappable.',
    };

    const vividness = clamp(m.avgSaturation * 1.4, 0, 1);
    cat.emotional_appeal = {
      score: round(vividness * 5),
      reason: vividness > 0.6
        ? 'Rich, saturated color palette that reads as energetic and attention-grabbing.'
        : vividness > 0.3
          ? 'Moderate color intensity - present but not particularly vivid.'
          : 'Desaturated, muted palette. This can read as premium in the right category, or flat and low-energy in others.',
      recommendation: 'If the brand allows it, push saturation on the hero subject specifically, not the whole frame, to draw the eye without looking artificial.' + PIXEL_CAVEAT,
    };

    cat.offer_clarity = {
      score: 3,
      reason: 'Offer clarity depends on reading the actual headline and price or promo copy, which pixel analysis cannot do reliably.' + PIXEL_CAVEAT,
      recommendation: 'State the offer, price, discount, or benefit, in the first 3 to 4 words of on-image text. Do not make the viewer read a full sentence to find it.',
    };

    cat.trust_signals = {
      score: 2,
      reason: 'Detecting review stars, badges, or testimonial text requires semantic understanding of the image content.' + PIXEL_CAVEAT,
      recommendation: 'Add a recognizable trust cue - star rating, review count, as-seen-in mention, or a guarantee badge - near the product or CTA.',
    };

    const brandRaw = clamp(m.distinctColors / 40, 0, 1);
    cat.brand_presence = {
      score: round(Math.min(brandRaw, 0.7) * 5),
      reason: 'Logo and brand-mark detection needs semantic image understanding. This score is a rough color-palette proxy only.' + PIXEL_CAVEAT,
      recommendation: 'Keep a logo or wordmark visible but small, under 10% of the frame, usually in a top corner or bottom bar so brand recall does not cost hierarchy.',
    };

    const ratioInfo = classifyAspectRatio(m.ratio);
    const topZoneEdge = m.grid[0].reduce((a, cell) => a + cell.meanEdge, 0) / 3;
    const bottomZoneEdge = m.grid[2].reduce((a, cell) => a + cell.meanEdge, 0) / 3;
    const safeZoneRisk = clamp(((topZoneEdge + bottomZoneEdge) / 2) / 55, 0, 1);
    const platformRaw = (ratioInfo.exactMatch ? 0.6 : 0.25) + (1 - safeZoneRisk) * 0.4;
    cat.platform_readiness = {
      score: round(clamp(platformRaw, 0, 1) * 5),
      reason: ratioInfo.exactMatch
        ? `Matches a standard Meta placement ratio (${ratioInfo.nearest}).`
        : `Ratio (${m.ratio.toFixed(2)}:1) does not cleanly match a standard placement, so Meta may letterbox or auto-crop it.`,
      recommendation: ratioInfo.exactMatch
        ? 'Double-check that key content sits inside the safe zone for Story or Reels if you plan to repurpose this creative into those placements.'
        : `Export a version at exactly ${ratioInfo.nearest} to avoid automatic cropping.`,
    };

    return { categories: cat, ratioInfo, safeZoneRisk };
  }

  function buildResult(m, scored) {
    const catList = AppConfig.CATEGORIES.map((def) => {
      const s = scored.categories[def.key];
      return {
        key: def.key,
        title: def.title,
        score: clamp(s.score, 0, def.max),
        max: def.max,
        reason: s.reason,
        recommendation: s.recommendation,
      };
    });

    const overall = clamp(round(catList.reduce((sum, cat) => sum + cat.score, 0)), 0, 100);
    const rating = AppConfig.ratingFor(overall).label;

    const ranked = [...catList].sort((a, b) => (b.score / b.max) - (a.score / a.max));
    const strengths = ranked.slice(0, 3).map((cat) => `${cat.title}: ${cat.reason}`);
    const weaknesses = ranked.slice(-3).reverse().map((cat) => `${cat.title}: ${cat.reason}`);

    const quickFixes = [...catList]
      .sort((a, b) => (a.score / a.max) - (b.score / b.max))
      .slice(0, 4)
      .map((cat) => cat.recommendation);

    const improvements = [...catList]
      .map((cat) => ({ title: cat.title, pointsLeft: cat.max - cat.score, text: cat.recommendation }))
      .sort((a, b) => b.pointsLeft - a.pointsLeft)
      .filter((cat) => cat.pointsLeft > 0)
      .slice(0, 6)
      .map((cat) => `${cat.text} (+${cat.pointsLeft} pts potential in ${cat.title})`);

    const ctrTiers = ['Low', 'Medium', 'High', 'Very High'];
    const predictedCtr = ctrTiers[clamp(Math.floor(overall / 26), 0, 3)];
    const predictedConversion = ctrTiers[clamp(Math.floor((overall - 5) / 26), 0, 3)];
    const thumbStop = clamp(round((catList.find((cat) => cat.key === 'hook_visibility').score / 15) * 10), 0, 10);
    const metaTextWarning = m.textDensity > 0.13;

    const summary = `This creative scores ${overall}/100 (${rating}). ` +
      `${strengths.length ? strengths[0].split(':')[0] : 'Composition'} is the strongest area; ` +
      `${weaknesses.length ? weaknesses[0].split(':')[0] : 'overall polish'} is the biggest opportunity. ` +
      'This browser-based audit uses pixel analysis, so categories that depend on reading text or logos are flagged and scored conservatively.';

    return {
      mode: 'heuristic',
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
      thumb_stop_rating: thumbStop,
      meta_text_warning: metaTextWarning,
      aspect_ratio: scored.ratioInfo,
      metrics: m,
    };
  }

  function runHeuristicAnalysis(imgElement) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const m = extractMetrics(imgElement);
        const scored = scoreHeuristically(m);
        resolve(buildResult(m, scored));
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
  };
})();
