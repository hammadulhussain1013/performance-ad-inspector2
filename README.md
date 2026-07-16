# Performance Ad Inspector

Performance Ad Inspector is a browser-based Meta ad creative audit tool for
static Facebook and Instagram image ads. Upload a creative and the app returns
a 100-point scorecard with category-level reasoning, quick wins, and
high-impact improvement ideas.

No build step. No backend. No login required.

## Running it

Open `index.html` in a browser. If your browser is strict about local canvas
or script loading, serve the folder locally instead:

```bash
cd performance-ad-inspector
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## What it checks

The audit scores each uploaded creative across 12 categories:

- Visual Hierarchy
- Hook Visibility
- CTA Visibility
- Brand Presence
- Product Focus
- Whitespace
- Contrast
- Readability
- Emotional Appeal
- Offer Clarity
- Trust Signals
- Platform Readiness

It also includes:

- Attention heatmap overlay
- Safe-zone overlays for Feed, Story, and Reels
- Text density estimate
- Contrast checker
- Aspect-ratio and placement compatibility checks

## How the scoring works

The app analyzes the uploaded image directly in the browser using pixel-based
signals such as luminance contrast, edge density, regional composition,
saturation, and aspect ratio. Categories that depend on reading actual text or
recognizing logos are scored conservatively and labeled that way in the UI.

## File structure

```text
performance-ad-inspector/
|-- index.html
|-- css/
|   `-- styles.css
`-- js/
    |-- config.js
    |-- imageAnalysis.js
    |-- canvasOverlays.js
    |-- render.js
    `-- main.js
```

## Notes

- The tool currently supports one PNG, JPG, or WEBP image at a time.
- Images stay on the local device during analysis.
- The text-density warning is an estimate, not an official Meta overlay check.
