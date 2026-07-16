/* ==========================================================================
   config.js
   Single source of truth for scoring weights, rating bands, and platform
   specs used by the browser-side audit.
   ========================================================================== */

const AppConfig = (() => {
  const CATEGORIES = [
    { key: 'visual_hierarchy', title: 'Visual Hierarchy', max: 15 },
    { key: 'hook_visibility', title: 'Hook Visibility', max: 15 },
    { key: 'cta_visibility', title: 'CTA Visibility', max: 10 },
    { key: 'brand_presence', title: 'Brand Presence', max: 5 },
    { key: 'product_focus', title: 'Product Focus', max: 10 },
    { key: 'whitespace', title: 'Whitespace', max: 10 },
    { key: 'contrast', title: 'Contrast', max: 5 },
    { key: 'readability', title: 'Readability', max: 10 },
    { key: 'emotional_appeal', title: 'Emotional Appeal', max: 5 },
    { key: 'offer_clarity', title: 'Offer Clarity', max: 5 },
    { key: 'trust_signals', title: 'Trust Signals', max: 5 },
    { key: 'platform_readiness', title: 'Platform Readiness', max: 5 },
  ];

  const totalPoints = CATEGORIES.reduce((sum, category) => sum + category.max, 0);
  if (totalPoints !== 100) {
    console.warn(`AppConfig: category weights sum to ${totalPoints}, expected 100.`);
  }

  const RATING_BANDS = [
    { min: 90, label: 'Excellent', color: '#00D99A' },
    { min: 75, label: 'Good', color: '#3CE8B0' },
    { min: 55, label: 'Average', color: '#FFB020' },
    { min: 35, label: 'Needs Improvement', color: '#FF8A5B' },
    { min: 0, label: 'Poor', color: '#FF4D6D' },
  ];

  const PLATFORM_RATIOS = {
    feed_square: { ratio: 1, label: '1:1 Feed' },
    feed_portrait: { ratio: 4 / 5, label: '4:5 Feed' },
    story_reels: { ratio: 9 / 16, label: '9:16 Story/Reels' },
    landscape: { ratio: 1.91, label: '1.91:1 Landscape' },
  };

  const PLACEMENT_SPECS = {
    feed: {
      label: 'Feed',
      ratios: [1, 4 / 5, 1.91],
      preferredRatio: 4 / 5,
      standardizedSize: '1080x1350 preferred',
      alternates: ['1080x1080', '1200x628'],
      tolerance: 0.045,
    },
    story: {
      label: 'Story',
      ratios: [9 / 16],
      preferredRatio: 9 / 16,
      standardizedSize: '1080x1920 master',
      alternates: [],
      tolerance: 0.025,
    },
    reels: {
      label: 'Reels',
      ratios: [9 / 16],
      preferredRatio: 9 / 16,
      standardizedSize: '1080x1920 master',
      alternates: [],
      tolerance: 0.025,
    },
    carousel: {
      label: 'Carousel',
      ratios: [1, 4 / 5],
      preferredRatio: 1,
      standardizedSize: '1080x1080 preferred',
      alternates: ['1080x1350'],
      tolerance: 0.045,
    },
  };

  const SAFE_ZONES = {
    feed: { top: 0.02, bottom: 0.02, left: 0.02, right: 0.02 },
    story: { top: 0.14, bottom: 0.20, left: 0.06, right: 0.06 },
    reels: { top: 0.14, bottom: 0.34, left: 0.06, right: 0.12 },
  };

  const ADVANCED_RESEARCH = {
    provider: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    apiKey: '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',
    imageMaxEdge: 1280,
    maxBase64Bytes: 4 * 1024 * 1024,
    requestTimeoutMs: 120000,
    temperature: 0.2,
  };

  function ratingFor(score) {
    return RATING_BANDS.find((band) => score >= band.min) || RATING_BANDS[RATING_BANDS.length - 1];
  }

  return {
    CATEGORIES,
    PLATFORM_RATIOS,
    PLACEMENT_SPECS,
    RATING_BANDS,
    SAFE_ZONES,
    ADVANCED_RESEARCH,
    ratingFor,
  };
})();
