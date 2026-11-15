import { Battle } from '../engine/battle.js';
import { ABILITIES, HERO, QTE_WINDOW, STAGES } from '../engine/data.js';
import { HeroStage } from '../stage/heroStage.js';
import { runQte } from './qte.js';

// Placeholder art until enemies get 3D models.
const SPRITES = {
  Goblin: { glyph: '👺', bg: 'linear-gradient(160deg,#4f7a3a,#2a4220)' },
  'Frost Wolf': { glyph: '🐺', bg: 'linear-gradient(160deg,#5aa0c8,#2b4f70)' },
  Bomb: { glyph: '💣', bg: 'linear-gradient(160deg,#c8603a,#6e2b1a)' },
  Ogre: { glyph: '👹', bg: 'linear-gradient(160deg,#8a4fb0,#432363)' },
};
const ELEMENT_CLASS = { fire: 'fire', ice: 'ice', thunder: 'thunder' };
const TURN_PAUSE = 700; // ms an action stays on screen before the next turn
const WAVE_PAUSE = 1600;
const WINDUP = 380; // ms an enemy telegraphs before its parry prompt starts

const $ = (id) => document.getElementById(id);
const el = {
  game: $('game'),
  wave: $('wave'),
  turns: $('turns'),
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
  commands: $('commands'),
  qteLayer: $('qte-layer'),
  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  overlaySub: $('overlay-sub'),
  overlayBtn: $('overlay-btn'),
  btnAuto: $('btn-auto'),
};

// Per-viewer UI preferences; the game works fine if storage is unavailable.
const PREFS_KEY = 'hex-battler-prefs';
const prefs = loadPrefs();
function loadPrefs() {
  const defaults = { auto: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

let battle;
let session = 0; // bumps on every new battle so stale timers and QTEs bail out
let targetId = null;
let enemyEls = new Map();
let bannerTimer = 0;
const stage = new HeroStage(el.field);

const later = (ms, fn) => {
  const id = session;
  setTimeout(() => id === session && fn(), ms);
};

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

el.btnAuto.addEventListener('click', () => {
  prefs.auto = !prefs.auto;
  savePrefs();
  renderToggles();
  battle.setAuto(prefs.auto);
});
el.overlayBtn.addEventListener('click', newBattle);

function renderToggles() {
  el.btnAuto.classList.toggle('on', prefs.auto);
}

// ---------- Battle lifecycle ----------
function newBattle() {
  session++;
  el.qteLayer.innerHTML = '';
  battle = new Battle({
    hero: HERO,
    stage: STAGES.forest,
    seed: (Math.random() * 2 ** 32) >>> 0,
    auto: prefs.auto,
  });
  battle.on(handleEvent);
  el.overlay.classList.add('hidden');
  stage.reset();
  renderToggles();
  battle.start();
}

function handleEvent(e) {
  switch (e.type) {
    case 'waveStart':
      buildEnemies();
      el.wave.textContent = `Wave ${e.wave + 1}/${e.total}`;
      showBanner(e.wave + 1 === e.total ? 'Boss Battle!' : `Wave ${e.wave + 1}`);
      break;
    case 'turnStart':
      renderTurns();
      break;
    case 'heroTurn':
      if (!battle.auto) showBanner('Your turn');
      break;
    case 'actionStart': {
      const ability = ABILITIES[e.abilityId];
      const actor = battle.unit(e.actorId);
      showBanner(`${actor.name} — ${ability.name}`);
      if (e.actorId === 'hero') playHeroMove(ability);
      if (e.qte === 'parry') enemyEls.get(e.actorId)?.root.classList.add('windup');
      if (e.qte) startQte(e);
      break;
    }
    case 'qteResult':
      enemyEls.get(e.actorId)?.root.classList.remove('windup');
      if (e.kind === 'parry') replayClass(enemyEls.get(e.actorId)?.root, 'lunge');
      break;
    case 'parry':
      stage.parry(); // the QTE itself shows "PARRY!"
      break;
    case 'damage': {
      const target = unitEl(e.targetId);
      if (e.targetId === 'hero') {
        stage.hit();
        replayClass(el.hero, 'hit');
      } else {
        replayClass(target, 'hit');
      }
      const notes = [e.perfect && 'PERFECT', e.tag === 'weak' && 'WEAK!', e.tag === 'resist' && 'resist'];
      floatText(target, e.amount, e.perfect ? 'perfect' : (e.tag ?? ''), notes.filter(Boolean).join(' · '));
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
    case 'turnEnd':
      later(TURN_PAUSE, () => battle.next());
      break;
    case 'waveCleared':
      showBanner('Wave cleared!');
      later(WAVE_PAUSE, () => battle.next());
      break;
    case 'victory':
      stage.victory();
      later(1200, () => showOverlay('Victory!', `Stage cleared with ${battle.hero.hp} HP left`, 'Play again'));
      break;
    case 'defeat':
      later(1600, () => showOverlay('Defeat', `Fell on wave ${battle.waveIndex + 1}`, 'Retry'));
      break;
  }
}

// Every prompt appears in the middle of the screen so the player always
// knows where to look. Enemy attacks get a short wind-up first so the player
// can see who is swinging.
function startQte(e) {
  const id = session;
  const ability = ABILITIES[e.abilityId];
  const delay = e.qte === 'parry' ? WINDUP : 120;
  later(delay, async () => {
    const { success } = await runQte(el.qteLayer, {
      ...screenCenter(),
      kind: e.qte,
      duration: ability.qteTime,
      window: QTE_WINDOW[e.qte],
    });
    if (id === session) battle.resolveQte(success);
  });
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
      <div class="bar hp"><div class="fill"></div></div>`;
    root.addEventListener('click', () => {
      if (enemy.hp > 0) targetId = enemy.id;
    });
    el.enemies.appendChild(root);
    const hpFill = root.querySelector('.fill');
    enemyEls.set(enemy.id, { root, sprite: root.querySelector('.sprite'), hpBar: hpFill.parentElement, hpFill });
  }
  targetId = battle.enemies[0]?.id ?? null;
}

// ---------- Rendering ----------
function renderTurns() {
  el.turns.innerHTML = battle
    .upcoming(7)
    .map((id, i) => {
      const unit = battle.unit(id);
      const isHero = id === 'hero';
      const face = isHero ? 'YOU' : (SPRITES[unit.name]?.glyph ?? '?');
      return `<li class="turn${isHero ? ' hero' : ''}${i === 0 ? ' now' : ''}" title="${unit.name}">${face}</li>`;
    })
    .join('');
}

function render() {
  const hero = battle.hero;
  el.heroHp.textContent = `${hero.hp}/${hero.maxHp}`;
  el.heroHpFill.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
  el.heroHpFill.parentElement.classList.toggle('low', hero.hp / hero.maxHp < 0.3);
  stage.setHurt(hero.hp > 0 && hero.hp / hero.maxHp < 0.3);
  el.heroMp.textContent = `${hero.mp}/${hero.maxMp}`;
  el.heroMpFill.style.width = `${(hero.mp / hero.maxMp) * 100}%`;
  el.heroStatus.textContent = hero.defending ? 'GUARD' : '';

  const awaiting = battle.phase === 'command' && !battle.auto;
  el.hero.classList.toggle('ready', awaiting);
  for (const { ability, btn } of commandButtons) {
    btn.disabled = !awaiting || hero.mp < ability.mp;
  }

  for (const enemy of battle.enemies) {
    const view = enemyEls.get(enemy.id);
    if (!view) continue;
    view.hpFill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
    view.hpBar.classList.toggle('low', enemy.hp / enemy.maxHp < 0.3);
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

function screenCenter() {
  return { x: el.game.clientWidth / 2, y: el.game.clientHeight / 2 };
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
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  bannerTimer -= dt;
  if (bannerTimer <= 0) el.banner.classList.remove('show');
  stage.update(dt, dt);
  const head = stage.headScreenPosition();
  el.heroAnchor.style.transform = `translate(${head.x}px, ${head.y}px)`;
  render();
  requestAnimationFrame(frame);
}

newBattle();
requestAnimationFrame(frame);
