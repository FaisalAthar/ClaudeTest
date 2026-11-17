// Timed-press prompt: a thick hexagon outline closes in on a solid hexagon.
// Tap (or press Space) as the outline settles around the core. Its resting
// shape (thick frame, gap, solid core) is the target emblem itself.

const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2; // pointy top
  return `${(Math.cos(a) * 50).toFixed(2)},${(Math.sin(a) * 50).toFixed(2)}`;
}).join(' ');

const START_SCALE = 3.2;
const SVG_NS = 'http://www.w3.org/2000/svg';

function hex(cls, scale) {
  const p = document.createElementNS(SVG_NS, 'polygon');
  p.setAttribute('points', HEX_POINTS);
  p.setAttribute('class', cls);
  p.setAttribute('transform', `scale(${scale})`);
  return p;
}

let shown = 0;

/**
 * Runs one QTE centred on (x, y) inside `layer` (CSS px).
 *   kind:     'attack' | 'parry' (colours and result text)
 *   duration: seconds until the outline meets the core
 *   window:   half-width of the success window, seconds
 * Resolves to { success, offset } where offset is tap time minus the ideal
 * moment in seconds (negative = early), or null if there was no tap.
 */
export function runQte(layer, { x, y, kind, duration, window }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = `qte qte-${kind}`;
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-170 -170 340 340');
    const core = hex('qte-core', 0.62);
    const frame = hex('qte-frame', 1);
    const ring = hex('qte-ring', START_SCALE);
    svg.append(frame, core, ring);
    root.appendChild(svg);

    const label = document.createElement('div');
    label.className = 'qte-label';
    label.textContent = kind === 'parry' ? 'PARRY' : '';
    root.appendChild(label);
    if (shown++ < 2) {
      const hint = document.createElement('div');
      hint.className = 'qte-hint';
      hint.textContent = 'Tap as the hexagons meet';
      root.appendChild(hint);
    }

    // Dark backdrop centred on the prompt so it reads over the 3D scene.
    const backdrop = document.createElement('div');
    backdrop.className = 'qte-backdrop';
    backdrop.style.setProperty('--qx', `${x}px`);
    backdrop.style.setProperty('--qy', `${y}px`);

    // Full-screen catcher so a tap anywhere counts.
    const catcher = document.createElement('div');
    catcher.className = 'qte-catcher';
    layer.append(backdrop, catcher, root);

    const start = performance.now();
    const ideal = duration * 1000;
    root.dataset.ideal = String(ideal); // lets automated play tests tap on cue
    let done = false;
    let raf = 0;

    function finish(tapAt) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      catcher.remove();
      removeEventListener('keydown', onKey);
      const offset = tapAt === null ? null : (tapAt - start - ideal) / 1000;
      const success = offset !== null && Math.abs(offset) <= window;
      ring.setAttribute('transform', 'scale(1)');
      root.classList.add(success ? 'qte-success' : 'qte-fail');
      label.textContent = success
        ? kind === 'parry'
          ? 'PARRY!'
          : 'PERFECT ×2'
        : offset === null
          ? 'MISS'
          : offset < 0
            ? 'TOO EARLY'
            : 'TOO LATE';
      backdrop.classList.add('qte-backdrop-out');
      setTimeout(() => {
        root.remove();
        backdrop.remove();
      }, 650);
      resolve({ success, offset });
    }

    function onTap(e) {
      e.preventDefault();
      finish(performance.now());
    }
    function onKey(e) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        finish(performance.now());
      }
    }
    catcher.addEventListener('pointerdown', onTap);
    addEventListener('keydown', onKey);

    function tick(now) {
      const t = (now - start) / ideal; // 1 = contact
      // Ease in so the last stretch is readable; continue shrinking past the
      // core so a late tap visibly overshoots.
      const scale = t <= 1 ? 1 + (START_SCALE - 1) * (1 - t) ** 1.6 : Math.max(0.55, 1 - (t - 1) * 2.2);
      ring.setAttribute('transform', `scale(${scale.toFixed(4)})`);
      root.classList.toggle('qte-live', Math.abs(now - start - ideal) <= window * 1000);
      if (now - start > ideal + window * 1000) return finish(null);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
  });
}
