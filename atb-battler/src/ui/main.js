import { Battle } from '../engine/battle.js';
import { ABILITIES, HERO, STAGES } from '../engine/data.js';
import { HeroStage } from '../stage/heroStage.js';

// Placeholder art until phase 2 swaps in 3D models.
const SPRITES = {
  Goblin: { glyph: '👺', bg: 'linear-gradient(160deg,#4f7a3a,#2a4220)' },
  'Frost Wolf': { glyph: '🐺', bg: 'linear-gradient(160deg,#5aa0c8,#2b4f70)' },
  Bomb: { glyph: '💣', bg: 'linear-gradient(160deg,#c8603a,#6e2b1a)' },
  Ogre: { glyph: '👹', bg: 'linear-gradient(160deg,#8a4fb0,#432363)' },
};
const ELEMENT_CLASS = { fire: 'fire', ice: 'ice', thunder: 'thunder' };
const SPEEDS = [1, 2, 3];

const $ = (id) => document.getElementById(id);
const el = {
  wave: $('wave'),
  field: $('field'),
  heroAnchor: $('hero-anchor'),
  enemies: $('enemies'),
  banner: $('banner'),
  hero: $('hero'),
  heroStatus: $('hero-status'),
  heroHp: $('hero-hp'),
  heroHpFill: $('hero-hp-fill'),
  heroMp: $('hero-mp'),
  heroMpFill: $('hero-mp-fill'),
  heroAtbFill: $('hero-atb-fill'),
  commands: $('commands'),
  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  overlaySub: $('overlay-sub'),
  overlayBtn: $('overlay-btn'),
  btnAuto: $('btn-auto'),
  btnSpeed: $('btn-speed'),
  btnMode: $('btn-mode'),
};

// Per-viewer UI preferences; the game works fine if storage is unavailable.
const prefs = loadPrefs();
function loadPrefs() {
  const defaults = { auto: false, speed: 1, atbMode: 'active' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('atb-prefs') || '{}') };
  } catch {
    return defaults;
  }
}
function savePrefs() {
  try {
    localStorage.setItem('atb-prefs', JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

let battle;
let targetId = null;
let enemyEls = new Map();
let bannerTimer = 0;
const stage = new HeroStage(el.field);

// ---------- Commands ----------
const commandButtons = HERO.abilities.map((id) => {
  const ability = ABILITIES[id];
  const btn = document.createElement('button');
  btn.className = 'cmd';
  if (ability.element) btn.classList.add(ELEMENT_CLASS[ability.element]);
  if (ability.kind === 'heal') btn.classList.add('heal');
  btn.innerHTML = `<span class="name">${ability.name}</span><span class="cost">${
    ability.mp ? `${ability.mp} MP` : '&nbsp;'
  }</span>`;
  btn.addEventListener('click', () => {
    const result = battle.command(id, targetId);
    if (!result.ok && result.reason === 'no-mp') showBanner('Not enough MP');
  });
  el.commands.appendChild(btn);
  return { id, ability, btn };
});

// ---------- Toggles ----------
el.btnAuto.addEventListener('click', () => {
  prefs.auto = !prefs.auto;
  battle.setAuto(prefs.auto);
  savePrefs();
  renderToggles();
});
el.btnSpeed.addEventListener('click', () => {
  prefs.speed = SPEEDS[(SPEEDS.indexOf(prefs.speed) + 1) % SPEEDS.length];
  savePrefs();
  renderToggles();
});
el.btnMode.addEventListener('click', () => {
  prefs.atbMode = prefs.atbMode === 'active' ? 'wait' : 'active';
  battle.setAtbMode(prefs.atbMode);
  savePrefs();
  renderToggles();
});
el.overlayBtn.addEventListener('click', newBattle);

function renderToggles() {
  el.btnAuto.classList.toggle('on', prefs.auto);
  el.btnSpeed.textContent = `${prefs.speed}×`;
  el.btnSpeed.classList.toggle('on', prefs.speed > 1);
  el.btnMode.textContent = prefs.atbMode === 'active' ? 'Active' : 'Wait';
}

// ---------- Battle lifecycle ----------
function newBattle() {
  battle = new Battle({
    hero: HERO,
    stage: STAGES.forest,
    seed: (Math.random() * 2 ** 32) >>> 0,
    atbMode: prefs.atbMode,
    auto: prefs.auto,
  });
  battle.on(handleEvent);
  el.overlay.classList.add('hidden');
  stage.reset();
  battle.start();
  renderToggles();
}

function handleEvent(e) {
  switch (e.type) {
    case 'waveStart':
      buildEnemies();
      el.wave.textContent = `Wave ${e.wave + 1}/${e.total}`;
      showBanner(e.wave + 1 === e.total ? 'Boss Battle!' : `Wave ${e.wave + 1}`);
      break;
    case 'actionStart': {
      const ability = ABILITIES[e.abilityId];
      const actor = battle.unit(e.actorId);
      showBanner(`${actor.name} — ${ability.name}`);
      if (e.actorId === 'hero') playHeroMove(ability);
      else replayClass(unitEl(e.actorId), 'lunge');
      break;
    }
    case 'damage': {
      const target = unitEl(e.targetId);
      if (e.targetId === 'hero') {
        stage.hit();
        replayClass(el.hero, 'hit');
      } else {
        replayClass(target, 'hit');
      }
      const note = e.tag === 'weak' ? 'WEAK!' : e.tag === 'resist' ? 'resist' : '';
      floatText(target, e.amount, e.tag ?? '', note);
      break;
    }
    case 'heal':
      floatText(unitEl(e.targetId), `+${e.amount}`, 'heal');
      break;
    case 'mpGain':
      floatText(unitEl(e.actorId), `+${e.amount} MP`, 'mp');
      break;
    case 'defend':
      floatText(unitEl(e.actorId), 'Guard', 'mp');
      break;
    case 'ko':
      if (e.unitId === 'hero') {
        stage.ko();
      } else {
        enemyEls.get(e.unitId)?.root.classList.add('ko');
        if (targetId === e.unitId) targetId = battle.livingEnemies()[0]?.id ?? null;
      }
      break;
    case 'waveCleared':
      showBanner('Wave cleared!');
      break;
    case 'victory':
      stage.victory();
      showOverlay('Victory!', `Stage cleared with ${battle.hero.hp} HP left`, 'Play again');
      break;
    case 'defeat':
      showOverlay('Defeat', `Fell on wave ${battle.waveIndex + 1}`, 'Retry');
      break;
  }
}

function buildEnemies() {
  el.enemies.innerHTML = '';
  enemyEls = new Map();
  for (const enemy of battle.enemies) {
    const art = SPRITES[enemy.name] ?? { glyph: '❓', bg: '#333' };
    const root = document.createElement('div');
    root.className = 'enemy' + (enemy.boss ? ' boss' : '');
    const tags = [
      ...enemy.weak.map((w) => `<span class="tag weak">${w}</span>`),
      ...enemy.resist.map((r) => `<span class="tag resist">${r}</span>`),
    ].join('');
    root.innerHTML = `
      <div class="sprite" style="background:${art.bg}">${art.glyph}</div>
      <div class="enemy-name">${enemy.name}</div>
      <div class="tags">${tags}</div>
      <div class="bar hp"><div class="fill"></div></div>
      <div class="bar atb"><div class="fill"></div></div>`;
    root.addEventListener('click', () => {
      if (enemy.hp > 0) targetId = enemy.id;
    });
    el.enemies.appendChild(root);
    const [hpFill, atbFill] = root.querySelectorAll('.fill');
    enemyEls.set(enemy.id, { root, hpBar: hpFill.parentElement, hpFill, atbFill });
  }
  targetId = battle.enemies[0]?.id ?? null;
}

// ---------- Rendering ----------
function render() {
  const hero = battle.hero;
  el.heroHp.textContent = `${hero.hp}/${hero.maxHp}`;
  el.heroHpFill.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
  el.heroHpFill.parentElement.classList.toggle('low', hero.hp / hero.maxHp < 0.3);
  el.heroMp.textContent = `${hero.mp}/${hero.maxMp}`;
  el.heroMpFill.style.width = `${(hero.mp / hero.maxMp) * 100}%`;
  el.heroAtbFill.style.width = `${hero.atb * 100}%`;
  el.heroAtbFill.parentElement.classList.toggle('full', hero.atb >= 1);
  const queued = hero.state === 'queued' && battle.queue.find((q) => q.actorId === hero.id);
  el.heroStatus.textContent = queued ? `${ABILITIES[queued.abilityId].name}…` : hero.defending ? 'GUARD' : '';

  const awaiting = battle.phase === 'battle' && hero.state === 'ready' && !battle.auto;
  el.hero.classList.toggle('ready', awaiting);
  for (const { ability, btn } of commandButtons) {
    btn.disabled = !awaiting || hero.mp < ability.mp;
  }

  for (const enemy of battle.enemies) {
    const view = enemyEls.get(enemy.id);
    if (!view) continue;
    view.hpFill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
    view.hpBar.classList.toggle('low', enemy.hp / enemy.maxHp < 0.3);
    view.atbFill.style.width = `${enemy.atb * 100}%`;
    view.root.classList.toggle('targeted', enemy.id === targetId && enemy.hp > 0);
  }
}

function playHeroMove(ability) {
  if (ability.kind === 'physical') stage.attack();
  else if (ability.kind === 'magic') stage.cast(ability.element);
  else if (ability.kind === 'heal') stage.heal();
  else if (ability.kind === 'defend') stage.defend();
}

// Hero popups float over the 3D model's head rather than the stats panel.
function unitEl(id) {
  return id === 'hero' ? el.heroAnchor : enemyEls.get(id)?.root;
}

function replayClass(node, cls) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth; // restart the CSS animation
  node.classList.add(cls);
}

function floatText(node, text, cls, note = '') {
  if (!node) return;
  const span = document.createElement('span');
  span.className = `float ${cls}`;
  span.innerHTML = `${text}${note ? `<span class="note">${note}</span>` : ''}`;
  node.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
}

function showBanner(text) {
  el.banner.textContent = text;
  el.banner.classList.add('show');
  bannerTimer = 1.2;
}

function showOverlay(title, sub, button) {
  el.overlayTitle.textContent = title;
  el.overlaySub.textContent = sub;
  el.overlayBtn.textContent = button;
  el.overlay.classList.remove('hidden');
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  // Clamp so a backgrounded tab doesn't fast-forward the fight on return.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  battle.update(dt * prefs.speed);
  bannerTimer -= dt;
  if (bannerTimer <= 0) el.banner.classList.remove('show');
  stage.update(dt, dt * prefs.speed);
  const head = stage.headScreenPosition();
  el.heroAnchor.style.transform = `translate(${head.x}px, ${head.y}px)`;
  render();
  requestAnimationFrame(frame);
}

newBattle();
requestAnimationFrame(frame);
