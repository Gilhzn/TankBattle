import {
  BASE_TILE_X, BASE_TILE_Y, CATALOG_BY_SKU, TILE, applySnapshot, createViewState,
  type MatchResult, type PowerUpKind, type Snapshot, type TickEvent, type ViewState,
} from '@tank/shared';
import { h } from '../app/h.js';
import { settings, isCoarsePointer } from '../app/settings.js';
import { toast } from '../app/store.js';
import { sfx } from '../audio/sfx.js';
import { t, itemName } from '../i18n/index.js';
import { InputManager } from '../input/inputManager.js';
import type { GameTransport, MetaEvent } from '../net/transport.js';
import { Effects } from '../render/effects.js';
import { Renderer } from '../render/renderer.js';
import { COLORS, tankPalette } from '../render/theme.js';
import { POWERUP_COLORS } from '../render/sprites.js';
import { Hud } from './hud.js';
import { InterpBuffer } from './interp.js';

export interface GameOverInfo {
  reason: string;
  results?: MatchResult[];
  view: ViewState;
}

export interface GameViewOptions {
  transport: GameTransport;
  onGameOver: (info: GameOverInfo) => void;
  onQuit: () => void;
  /** Optional: the local host can be asked to revive (consumes a token). */
  canRevive?: () => boolean;
}

declare global {
  interface Window {
    __tank?: {
      view: ViewState;
      tick: number;
      mode: 'local' | 'online';
      screen: string;
      input: (dir: number, fire: boolean) => void;
    };
  }
}

const GAME_OVER_DELAY_MS = 1800;

export class GameView {
  readonly el: HTMLElement;
  readonly view = createViewState();
  private hasFull = false;
  private interp: InterpBuffer;
  private renderer: Renderer;
  private effects: Effects;
  private hud: Hud;
  private input: InputManager;
  private canvas: HTMLCanvasElement;
  private fieldWrap: HTMLElement;
  private bannerLayer: HTMLElement;
  private pauseOverlay: HTMLElement;
  private touchLayer: HTMLElement;
  private raf = 0;
  private lastFrame = 0;
  private running = false;
  private unsubs: Array<() => void> = [];
  private ro: ResizeObserver | null = null;
  private gameOverTimer = 0;
  private gameOverSent = false;
  private stageName = '';
  private bannerTimer = 0;
  private itemCounts: Record<string, number> = {};

  constructor(private opts: GameViewOptions) {
    const tr = opts.transport;
    this.interp = new InterpBuffer(tr.mode === 'local' ? 0 : 3, 8);
    this.effects = new Effects(() => settings.get().reducedMotion);
    this.canvas = h('canvas', { class: 'game-canvas', dataset: { testid: 'game-canvas' }, attrs: { 'aria-label': 'battlefield' } });
    this.renderer = new Renderer(this.canvas);
    this.bannerLayer = h('div', { class: 'banner-layer', attrs: { 'aria-live': 'polite' } });
    this.pauseOverlay = h(
      'div',
      { class: 'pause-overlay glass', dataset: { testid: 'pause-overlay' } },
      h('h2', null, t('hud.paused')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'pause-resume' }, onclick: () => this.resume() }, t('hud.resume')),
        h('button', { class: 'btn ghost', type: 'button', dataset: { testid: 'pause-quit' }, onclick: () => opts.onQuit() }, t('hud.quit')),
      ),
    );
    this.pauseOverlay.hidden = true;
    this.fieldWrap = h('div', { class: 'field-wrap' }, this.canvas, this.bannerLayer, this.pauseOverlay);
    this.hud = new Hud({ onPause: () => this.togglePause(), onUseItem: (sku) => this.useItem(sku) });
    this.touchLayer = h('div', { class: 'touch-layer', dataset: { testid: 'touch-controls' } });
    const coarse = isCoarsePointer();
    this.el = h('div', { class: `game-screen mode-${tr.mode}${coarse ? ' touch' : ''}` }, this.hud.el, this.fieldWrap, this.touchLayer);
    this.input = new InputManager({
      touchLayer: this.touchLayer,
      touch: { size: () => settings.get().joystickSize, haptics: () => settings.get().haptics },
      onChange: (inp) => tr.sendInput(inp),
      onPause: () => this.togglePause(),
    });
    this.itemCounts = tr.itemCounts();
    this.unsubs.push(tr.onSnapshot((s) => this.onSnapshot(s)));
    this.unsubs.push(tr.onEvent((events) => this.onEvents(events)));
    this.unsubs.push(tr.onMeta((m) => this.onMeta(m)));
  }

  get paused(): boolean {
    return this.opts.transport.paused;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.fieldWrap);
    this.layout();
    this.input.start();
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.__tank = {
      view: this.view,
      tick: 0,
      mode: this.opts.transport.mode,
      screen: this.opts.transport.mode === 'local' ? 'play' : 'game',
      input: (dir, fire) => {
        if (dir === -1 && !fire) this.input.setOverride(null);
        else this.input.setOverride({ dir: dir as 0 | 1 | 2 | 3 | -1, fire });
      },
    };
  }

  private layout(): void {
    const rect = this.fieldWrap.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    if (size > 0) this.renderer.resize(size);
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.opts.transport.mode === 'local' && this.view.status === 'playing') this.pause();
    } else if (this.running && !this.raf) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.input.poll();
    if (!this.paused) this.effects.update(dt);
    this.renderer.draw(this.view, this.interp, this.effects, now, {
      mySlot: this.opts.transport.mySlot,
      reducedMotion: settings.get().reducedMotion,
      powerUpLabel: (k: PowerUpKind) => t(`pu.${k}`),
    });
    this.hud.update(this.view, {
      rtt: this.opts.transport.mode === 'online' ? this.opts.transport.rtt : null,
      items: this.itemCounts,
      mySlot: this.opts.transport.mySlot,
      mode: this.opts.transport.mode,
      paused: this.paused,
    });
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Feed a snapshot directly (used for the `gameStart` snapshot that arrives before the view mounts). */
  pushSnapshot(snap: Snapshot): void {
    this.onSnapshot(snap);
  }

  private onSnapshot(snap: Snapshot): void {
    if (snap.full) {
      this.hasFull = true;
      if (snap.t < this.view.t) this.interp.clear();
    }
    if (!applySnapshot(this.view, snap, this.hasFull)) return;
    if (snap.full) this.renderer.invalidateTiles();
    this.interp.push(snap);
    if (snap.stageName) this.stageName = snap.stageName;
    if (window.__tank) {
      window.__tank.tick = snap.t;
      window.__tank.view = this.view;
    }
  }

  private onEvents(events: TickEvent[]): void {
    for (const ev of events) this.onEvent(ev);
  }

  private onEvent(ev: TickEvent): void {
    const fx = this.effects;
    switch (ev.type) {
      case 'shot':
        sfx.play('shot');
        break;
      case 'hit':
        fx.sparks(ev.x, ev.y);
        sfx.play('hit');
        break;
      case 'brick':
        fx.brick(ev.x, ev.y);
        sfx.play('brick');
        break;
      case 'explosion':
        fx.explosion(ev.x, ev.y, ev.big);
        sfx.play(ev.big ? 'bigExplosion' : 'explosion');
        break;
      case 'spawn': {
        const pal = tankPalette(ev.kind, 0, 'default', 1, 1);
        fx.spawnRing(ev.x, ev.y, ev.kind === 'player' ? COLORS.cyan : pal.glow);
        sfx.play('spawn');
        break;
      }
      case 'tankDestroyed':
        if (ev.kind !== 'player') fx.shake(0.3);
        break;
      case 'pickup':
        fx.pickup(ev.x, ev.y, POWERUP_COLORS[ev.kind]);
        fx.popup(ev.x, ev.y - TILE, t(`pu.${ev.kind}`).toUpperCase(), POWERUP_COLORS[ev.kind]);
        sfx.play('pickup');
        break;
      case 'powerupSpawn':
        fx.ring(ev.x, ev.y, 180, 600, POWERUP_COLORS[ev.kind], 6);
        break;
      case 'score':
        fx.popup(ev.x, ev.y, `+${ev.amount}`);
        break;
      case 'baseDestroyed':
        fx.explosion((BASE_TILE_X + 1) * TILE, (BASE_TILE_Y + 1) * TILE, true);
        this.banner(t('game.baseDestroyed'), '', 'danger', 2500);
        break;
      case 'stageClear':
        this.banner(t('game.stageClear'), `${t('common.score')} ${this.view.players[this.opts.transport.mySlot]?.score ?? 0}`, 'success', 2500);
        sfx.play('stageClear');
        break;
      case 'stageStart':
        this.banner(t('game.stageIntro', { n: ev.stage }), this.stageName, 'intro', 2200);
        break;
      case 'freeze':
        sfx.play('freeze');
        fx.flash = Math.max(fx.flash, 0.2);
        break;
      case 'grenade':
        fx.shake(1);
        fx.flash = 0.6;
        sfx.play('bigExplosion');
        break;
      case 'gameOver':
        this.handleGameOver(ev.reason);
        break;
      case 'playerDied':
        break;
    }
  }

  private handleGameOver(reason: string): void {
    this.banner(t('game.gameOver'), '', 'danger', 4000);
    sfx.play('gameOver');
    if (this.opts.transport.mode === 'online') return; // wait for the server's results
    window.clearTimeout(this.gameOverTimer);
    const canRevive = reason === 'lives' && (this.itemCounts.revive_token ?? 0) > 0;
    this.gameOverTimer = window.setTimeout(() => {
      if (this.view.status !== 'gameOver') return; // revived
      if (canRevive && (this.itemCounts.revive_token ?? 0) > 0) {
        this.showRevivePrompt();
        return;
      }
      this.finish(reason);
    }, GAME_OVER_DELAY_MS);
  }

  private showRevivePrompt(): void {
    const prompt = h(
      'div',
      { class: 'revive-prompt glass', dataset: { testid: 'revive-prompt' } },
      h('p', null, t('game.reviveOffer')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { prompt.remove(); this.useItem('revive_token'); } }, `${t('hud.revive')} (${this.itemCounts.revive_token ?? 0})`),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { prompt.remove(); this.finish('lives'); } }, t('common.cancel')),
      ),
    );
    this.fieldWrap.appendChild(prompt);
  }

  private finish(reason: string, results?: MatchResult[]): void {
    if (this.gameOverSent) return;
    this.gameOverSent = true;
    this.opts.onGameOver({ reason, results, view: this.view });
  }

  private onMeta(m: MetaEvent): void {
    switch (m.type) {
      case 'itemResult':
        if (m.inventory) this.itemCounts = { ...this.itemCounts, ...m.inventory };
        else this.itemCounts = this.opts.transport.itemCounts();
        if (m.ok) toast(t('hud.itemUsed', { item: itemName(m.sku, CATALOG_BY_SKU[m.sku]?.name ?? m.sku) }), 'success');
        else toast(t('hud.itemFailed', { error: m.error ?? '' }), 'error');
        break;
      case 'gameOver':
        this.finish(m.reason, m.results);
        break;
      case 'connection':
        if (m.state === 'reconnecting') this.banner(t('game.connectionLost'), '', 'danger', 0);
        else if (m.state === 'connected') this.clearBanner();
        break;
      case 'error':
        toast(m.message, 'error');
        break;
      case 'paused':
        this.pauseOverlay.hidden = !m.paused;
        break;
      case 'rtt':
        break;
    }
  }

  private useItem(sku: string): void {
    if (this.view.status !== 'playing' && sku !== 'revive_token') return;
    this.opts.transport.useItem(sku);
    this.itemCounts = this.opts.transport.itemCounts();
  }

  private banner(title: string, sub: string, kind: 'intro' | 'success' | 'danger', duration: number): void {
    this.clearBanner();
    const el = h('div', { class: `banner ${kind}`, dataset: { testid: 'banner' } }, h('div', { class: 'banner-title' }, title), sub ? h('div', { class: 'banner-sub' }, sub) : null);
    this.bannerLayer.appendChild(el);
    if (duration > 0) {
      this.bannerTimer = window.setTimeout(() => {
        el.classList.add('out');
        window.setTimeout(() => el.remove(), 400);
      }, duration);
    }
  }

  private clearBanner(): void {
    window.clearTimeout(this.bannerTimer);
    while (this.bannerLayer.firstChild) this.bannerLayer.removeChild(this.bannerLayer.firstChild);
  }

  pause(): void {
    if (this.opts.transport.mode !== 'local') return;
    this.opts.transport.pause();
    this.pauseOverlay.hidden = false;
  }
  resume(): void {
    this.opts.transport.resume();
    this.pauseOverlay.hidden = true;
  }
  togglePause(): void {
    if (this.opts.transport.mode !== 'local') return;
    if (this.paused) this.resume();
    else this.pause();
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.gameOverTimer);
    window.clearTimeout(this.bannerTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ro?.disconnect();
    this.input.stop();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.el.remove();
    if (window.__tank && window.__tank.view === this.view) window.__tank.screen = 'closed';
  }
}
