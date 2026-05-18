/* ============================================================
   ViT Explorer — interactive pipeline visualization
   ============================================================ */
(function () {
  const COLS = 4, ROWS = 3;
  const N_PATCHES = COLS * ROWS;
  const N_TOTAL = N_PATCHES + 1; // +1 for CLS

  const vfx = document.getElementById('vfx');
  const canvas = document.getElementById('vfxCanvas');
  const patchGrid = document.getElementById('vfxPatchGrid');
  const embed = document.getElementById('vfxEmbed');
  const qCol = document.getElementById('vfxQ');
  const kCol = document.getElementById('vfxK');
  const vCol = document.getElementById('vfxV');
  const outputCol = document.getElementById('vfxOutput');
  const blockCol = document.getElementById('vfxBlock');
  const matrix = document.getElementById('vfxMatrix');
  const caption = document.getElementById('vfxCaption');
  const stepNumEl = document.getElementById('vfxStepNum');
  const stepNameEl = document.getElementById('vfxStepName');
  const prev = document.getElementById('vfxPrev');
  const next = document.getElementById('vfxNext');
  const play = document.getElementById('vfxPlay');
  const scrub = document.getElementById('vfxScrub');
  const ribbon = document.getElementById('vfxRibbon');
  const traceSvg = document.getElementById('vfxTrace');
  const tracePath = document.getElementById('vfxTracePath');

  // ===== Color per token (stable across stages so a trace is visible) =====
  function tokenColor(i) {
    if (i === 0) return ''; // [CLS] keeps teal via CSS
    const hue = ((i - 1) * 31 + 18) % 360;
    return `linear-gradient(180deg, hsl(${hue}, 62%, 64%), hsl(${(hue + 28) % 360}, 64%, 42%))`;
  }
  function tokenStroke(i) {
    if (i === 0) return 'var(--tea)';
    const hue = ((i - 1) * 31 + 18) % 360;
    return `hsl(${hue}, 75%, 60%)`;
  }

  // ===== Build patch grid (image overlay) =====
  patchGrid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  patchGrid.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c + 1;
      const p = document.createElement('div');
      p.className = 'vfx-patch';
      p.dataset.token = i;
      p.title = `Patch ${i} — hover or click to trace`;
      patchGrid.appendChild(p);
    }
  }

  // ===== Build token columns =====
  function buildColumn(host) {
    host.innerHTML = '';
    const cls = document.createElement('div');
    cls.className = 'vfx-token vfx-token--cls';
    cls.dataset.token = 0;
    cls.title = '[CLS] — learnable classifier token';
    host.appendChild(cls);
    for (let i = 1; i <= N_PATCHES; i++) {
      const tok = document.createElement('div');
      tok.className = 'vfx-token';
      tok.dataset.token = i;
      tok.style.background = tokenColor(i);
      tok.title = `Token ${i}`;
      host.appendChild(tok);
    }
  }
  buildColumn(embed);
  buildColumn(qCol);
  buildColumn(kCol);
  buildColumn(vCol);
  buildColumn(outputCol);
  buildColumn(blockCol);

  // ===== Build attention matrix =====
  matrix.style.gridTemplateColumns = `repeat(${N_TOTAL}, 1fr)`;
  matrix.style.gridTemplateRows = `repeat(${N_TOTAL}, 1fr)`;
  for (let r = 0; r < N_TOTAL; r++) {
    for (let c = 0; c < N_TOTAL; c++) {
      const cell = document.createElement('div');
      cell.className = 'vfx-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.dataset.token = r; // hovering a row focuses on its query token
      let w;
      if (r === 0 || c === 0) {
        // [CLS] attends broadly
        w = 0.32 + Math.sin(r * 0.7 + c * 0.4) * 0.18;
      } else {
        const d = Math.abs(r - c);
        w = 0.88 - d * 0.14 + Math.sin(r * 1.1 + c * 0.9) * 0.14;
      }
      cell.style.opacity = Math.min(0.95, Math.max(0.05, w)).toFixed(2);
      matrix.appendChild(cell);
    }
  }

  // ===== Focus / trace =====
  let focusedToken = null;
  let pinnedToken = null;

  function clearFocus() {
    document.querySelectorAll('.is-traced').forEach(el => el.classList.remove('is-traced'));
    document.querySelectorAll('.is-traced-row, .is-traced-col').forEach(el => {
      el.classList.remove('is-traced-row', 'is-traced-col');
    });
    vfx.classList.remove('is-traced');
    tracePath.setAttribute('d', '');
  }

  function setFocus(token) {
    focusedToken = token;
    clearFocus();
    if (token === null) return;

    vfx.classList.add('is-traced');
    document.querySelectorAll(`[data-token="${token}"]`).forEach(el => {
      // Only highlight column tokens & patches & matrix row-cells
      if (el.classList.contains('vfx-cell')) {
        el.classList.add('is-traced-row');
      } else {
        el.classList.add('is-traced');
      }
    });

    drawTrace(token);
  }

  function drawTrace(token) {
    const points = [];
    const canvasRect = canvas.getBoundingClientRect();

    function addCenter(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      points.push({
        x: (r.left + r.right) / 2 - canvasRect.left,
        y: (r.top + r.bottom) / 2 - canvasRect.top
      });
    }

    // Patch on image
    if (token !== 0) {
      addCenter(patchGrid.querySelector(`.vfx-patch[data-token="${token}"]`));
    } else {
      // CLS doesn't have a patch; use image's right edge as starting point
      const img = canvas.querySelector('.vfx-image');
      if (img) {
        const r = img.getBoundingClientRect();
        points.push({ x: r.right - canvasRect.left - 6, y: r.top - canvasRect.top + 8 });
      }
    }

    // Embed, Q, K, V columns
    [embed, qCol, kCol, vCol].forEach(col => {
      addCenter(col.querySelector(`.vfx-token[data-token="${token}"]`));
    });

    // Matrix row centroid
    const rowCells = matrix.querySelectorAll(`.vfx-cell[data-row="${token}"]`);
    if (rowCells.length > 0) {
      const first = rowCells[0].getBoundingClientRect();
      const last = rowCells[rowCells.length - 1].getBoundingClientRect();
      points.push({
        x: (first.left + last.right) / 2 - canvasRect.left,
        y: (first.top + first.bottom) / 2 - canvasRect.top
      });
    }

    // Output column
    addCenter(outputCol.querySelector(`.vfx-token[data-token="${token}"]`));

    // MLP waypoint — MLP is an operation (no per-token element), so route the
    // trace through the center of the MLP box so the data-flow reads
    // attn out → MLP → block out
    const mlpEl = canvas.querySelector('.vfx-stage[data-stage="mlp"] .vfx-op');
    if (mlpEl) {
      const r = mlpEl.getBoundingClientRect();
      points.push({
        x: (r.left + r.right) / 2 - canvasRect.left,
        y: (r.top + r.bottom) / 2 - canvasRect.top
      });
    }

    // Block output column (after MLP + residuals)
    addCenter(blockCol.querySelector(`.vfx-token[data-token="${token}"]`));

    if (points.length < 2) { tracePath.setAttribute('d', ''); return; }

    // Points are added in pipeline order (image → embed → q → k → v → attn → output → block).
    // Don't sort — the insertion order IS the data-flow order, and sorting by x breaks
    // when row 1 and row 2 stages have overlapping x ranges.
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1], p1 = points[i];
      const dx = (p1.x - p0.x) * 0.55;
      d += ` C ${(p0.x + dx).toFixed(1)} ${p0.y.toFixed(1)}, ${(p1.x - dx).toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    tracePath.setAttribute('d', d);
    tracePath.style.stroke = tokenStroke(token);
  }

  // ===== Hover & click delegation =====
  canvas.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-token]');
    if (!el) return;
    if (pinnedToken !== null) return;
    setFocus(parseInt(el.dataset.token, 10));
  });

  canvas.addEventListener('mouseleave', () => {
    if (pinnedToken === null) {
      focusedToken = null;
      clearFocus();
    }
  });

  canvas.addEventListener('click', (e) => {
    const el = e.target.closest('[data-token]');
    if (!el) {
      pinnedToken = null;
      focusedToken = null;
      clearFocus();
      return;
    }
    const t = parseInt(el.dataset.token, 10);
    if (pinnedToken === t) {
      pinnedToken = null;
      focusedToken = null;
      clearFocus();
    } else {
      pinnedToken = t;
      setFocus(t);
    }
  });

  // ===== Steps =====
  const STEPS = [
    {
      name: 'Image',
      caption: `Start with an image — just raw pixels. A ViT doesn&rsquo;t use convolutions, so it makes no built-in assumptions about spatial locality.`
    },
    {
      name: 'Patches',
      caption: `Cut the image into a regular grid of non-overlapping patches. A real ViT-Base uses 14&times;14 patches of 16&times;16 pixels for a 224&times;224 input.`
    },
    {
      name: 'Embed',
      caption: `Flatten each patch, project it through a learned linear layer to <code>D</code> dimensions, and add a positional encoding. Prepend a learnable <code>[CLS]</code> token at the top — the input sequence <code>X</code> is now <code>(N+1) &times; D</code>.`
    },
    {
      name: 'Q&middot;K&middot;V',
      caption: `Multiply <code>X</code> by three learned matrices to produce <code>Q</code> (queries), <code>K</code> (keys), <code>V</code> (values). Each token now has its own q, k, v vector.`
    },
    {
      name: 'Attention',
      caption: `Take <code>Q&middot;K<sup>T</sup></code> — every query against every key. Scale by <code>&radic;d<sub>k</sub></code> and softmax each row. <code>A</code> is an (N+1)&times;(N+1) attention map — row i shows how token i attends to every other token.`
    },
    {
      name: 'Output',
      caption: `That's just the MHA part. To finish the block, pass the attention output through an <code>MLP</code> (Linear → GELU → Linear, expanding to 4D inside) to produce the block output — ready to feed the next encoder block.`
    },
    {
      name: '&times;N Layers',
      caption: `Zoom out. Each encoder block has a standard transformer structure &mdash; <code>LayerNorm</code> &rarr; <code>Multi-Head Attention</code>, plus a residual that adds the input back in. Then <code>LayerNorm</code> &rarr; <code>MLP</code> (Linear &rarr; GELU &rarr; Linear), and another residual. Stack <code>N</code> of these &mdash; ViT-Base uses <code>N = 12</code>.`
    },
    {
      name: 'Classify',
      caption: `After the final encoder block, read out only the <code>[CLS]</code> token. Pass it through one more <code>LayerNorm</code> and an <code>MLP head</code>, then softmax over the class set &mdash; that&rsquo;s the prediction.`
    }
  ];

  let step = 1;
  let playing = false;
  let playTimer = null;

  function setStep(s) {
    step = Math.max(1, Math.min(STEPS.length, s));
    vfx.dataset.step = step;
    const sd = STEPS[step - 1];
    caption.innerHTML = sd.caption;
    stepNumEl.textContent = step;
    stepNameEl.innerHTML = sd.name;
    scrub.value = step;
    prev.disabled = step === 1;
    next.disabled = step === STEPS.length;
    document.querySelectorAll('.vfx-chip').forEach(c => {
      c.classList.toggle('is-active', parseInt(c.dataset.step, 10) === step);
    });
    if (focusedToken !== null) {
      requestAnimationFrame(() => drawTrace(focusedToken));
    }
  }

  prev.addEventListener('click', () => setStep(step - 1));
  next.addEventListener('click', () => setStep(step + 1));
  scrub.addEventListener('input', () => setStep(parseInt(scrub.value, 10)));
  ribbon.addEventListener('click', (e) => {
    const chip = e.target.closest('.vfx-chip');
    if (!chip) return;
    setStep(parseInt(chip.dataset.step, 10));
  });

  function stopPlay() {
    playing = false;
    play.textContent = '\u25B6'; // ▶
    play.setAttribute('aria-label', 'Play');
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
  }
  function startPlay() {
    playing = true;
    play.textContent = '\u23F8'; // ⏸
    play.setAttribute('aria-label', 'Pause');
    playTimer = setInterval(() => {
      if (step >= STEPS.length) { stopPlay(); }
      else { setStep(step + 1); }
    }, 3800);
  }
  play.addEventListener('click', () => playing ? stopPlay() : startPlay());

  // ===== Resize — redraw trace =====
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (focusedToken !== null) drawTrace(focusedToken);
    }, 80);
  });

  // ===== Initialize =====
  setStep(1);

  // Demo: briefly trace token 5 on page load so the affordance is obvious
  setTimeout(() => {
    if (focusedToken === null && pinnedToken === null) {
      setFocus(5);
      setTimeout(() => {
        if (pinnedToken === null) { focusedToken = null; clearFocus(); }
      }, 2400);
    }
  }, 900);
})();
