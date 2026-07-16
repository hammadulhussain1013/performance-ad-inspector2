/* ==========================================================================
   main.js
   Wires up upload/drag-drop, browser-only analysis, and the overlay tools.
   ========================================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  let currentFile = null;
  let currentImg = null;
  let currentObjectUrl = null;
  let lastResult = null;
  let activeOverlay = 'none';
  let activePlatform = 'feed';
  let isFilePickerOpen = false;

  const dropzone = $('dropzone');
  const dropzoneEmpty = $('dropzone-empty');
  const fileInput = $('file-input');
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BYTES = 10 * 1024 * 1024;
  const LOADING_MESSAGES = [
    'Reading pixels...',
    'Mapping contrast and edges...',
    'Scoring hierarchy and hook strength...',
    'Assembling your scorecard...',
  ];

  function showError(msg) {
    const banner = $('error-banner');
    banner.textContent = msg;
    banner.classList.remove('hidden');
    clearTimeout(showError._t);
    showError._t = setTimeout(() => banner.classList.add('hidden'), 4500);
  }

  function releaseObjectUrl() {
    if (!currentObjectUrl) return;
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  function canOpenPicker() {
    return $('dropzone-preview').classList.contains('hidden') && !isFilePickerOpen;
  }

  function openFilePicker() {
    if (!canOpenPicker()) return;
    isFilePickerOpen = true;
    fileInput.click();
  }

  function cycleLoadingMessages(messages) {
    let i = 0;
    $('loading-text').textContent = messages[0];
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      $('loading-text').textContent = messages[i];
    }, 1400);
    return () => clearInterval(interval);
  }

  function resetOverlayToolbar() {
    activeOverlay = 'none';
    document.querySelectorAll('.overlay-btn').forEach((btn) => {
      btn.classList.toggle('active-overlay', btn.dataset.overlay === 'none');
    });
    $('safezone-platform-row').classList.add('hidden');
    CanvasOverlays.clear($('tools-canvas'));
  }

  function drawActiveOverlay() {
    const canvas = $('tools-canvas');
    const img = $('tools-preview-img');
    CanvasOverlays.clear(canvas);
    if (!lastResult || !lastResult.metrics) return;

    if (activeOverlay === 'heatmap') {
      CanvasOverlays.drawHeatmap(canvas, img, lastResult.metrics);
    } else if (activeOverlay === 'safezone') {
      CanvasOverlays.drawSafeZones(canvas, img, activePlatform);
    } else if (activeOverlay === 'density') {
      CanvasOverlays.drawTextDensity(canvas, img, lastResult.metrics);
    }
  }

  function handleFile(file) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showError('Unsupported file type. Please upload a PNG, JPG, or WEBP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      showError('File is larger than 10MB. Please upload a smaller image.');
      return;
    }

    currentFile = file;
    releaseObjectUrl();
    currentObjectUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      currentImg = img;
      $('preview-img').src = currentObjectUrl;
      $('tools-preview-img').src = currentObjectUrl;
      $('dropzone-empty').classList.add('hidden');
      $('dropzone-preview').classList.remove('hidden');
      $('file-name').textContent = file.name;
      $('file-meta').textContent = `${(file.size / 1024).toFixed(0)} KB - ${file.type.split('/')[1].toUpperCase()}`;
      $('quick-ratio').textContent = `${(img.naturalWidth / img.naturalHeight).toFixed(2)}:1`;
      $('quick-resolution').textContent = `${img.naturalWidth}x${img.naturalHeight}`;
      $('results-section').classList.add('hidden');
      $('loading-section').classList.add('hidden');
      resetOverlayToolbar();
    };
    img.onerror = () => showError('Could not read that image. It may be corrupted.');
    img.src = currentObjectUrl;
  }

  function resetUpload() {
    currentFile = null;
    currentImg = null;
    lastResult = null;
    isFilePickerOpen = false;
    fileInput.value = '';
    releaseObjectUrl();
    $('preview-img').removeAttribute('src');
    $('tools-preview-img').removeAttribute('src');
    $('dropzone-preview').classList.add('hidden');
    $('dropzone-empty').classList.remove('hidden');
    $('results-section').classList.add('hidden');
    $('loading-section').classList.add('hidden');
    $('scan-sweep').classList.remove('active');
    $('scan-sweep').classList.add('hidden');
    resetOverlayToolbar();
  }

  $('browse-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openFilePicker();
  });

  dropzoneEmpty.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openFilePicker();
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragging');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    isFilePickerOpen = false;
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  window.addEventListener('focus', () => {
    window.setTimeout(() => {
      isFilePickerOpen = false;
    }, 250);
  });

  $('remove-file-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    resetUpload();
  });

  $('analyze-another-btn').addEventListener('click', () => {
    resetUpload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('analyze-btn').addEventListener('click', async () => {
    if (!currentFile || !currentImg) return;

    $('dropzone-preview').classList.add('hidden');
    $('loading-section').classList.remove('hidden');
    $('scan-sweep').classList.remove('hidden');
    $('scan-sweep').classList.add('active');

    const stopCycling = cycleLoadingMessages(LOADING_MESSAGES);

    try {
      lastResult = await ImageAnalysis.runHeuristicAnalysis(currentImg);
      stopCycling();
      $('loading-section').classList.add('hidden');
      $('scan-sweep').classList.remove('active');
      $('scan-sweep').classList.add('hidden');
      $('results-section').classList.remove('hidden');
      $('results-section').classList.add('fade-up');

      Render.renderAll(lastResult);
      resetOverlayToolbar();
      $('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      stopCycling();
      $('loading-section').classList.add('hidden');
      $('dropzone-preview').classList.remove('hidden');
      $('scan-sweep').classList.remove('active');
      $('scan-sweep').classList.add('hidden');
      showError(`Analysis failed: ${err.message}`);
    }
  });

  document.querySelectorAll('.overlay-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeOverlay = btn.dataset.overlay;
      document.querySelectorAll('.overlay-btn').forEach((node) => {
        node.classList.toggle('active-overlay', node === btn);
      });
      $('safezone-platform-row').classList.toggle('hidden', activeOverlay !== 'safezone');
      drawActiveOverlay();
    });
  });

  document.querySelectorAll('.platform-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePlatform = btn.dataset.platform;
      document.querySelectorAll('.platform-btn').forEach((node) => {
        node.classList.toggle('active-platform', node === btn);
      });
      if (activeOverlay === 'safezone') drawActiveOverlay();
    });
  });

  window.addEventListener('resize', () => {
    if (activeOverlay !== 'none') drawActiveOverlay();
  });
})();
