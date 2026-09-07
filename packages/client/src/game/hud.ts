import { CATALOG, SKINS, TICK_RATE, type ViewState } from '@tank/shared';
import { h, clear } from '../app/h.js';
import { t } from '../i18n/index.js';

export interface HudCallbacks {
  onPause: () => void;
  onUseItem: (sku: string) => void;
}

export interface HudInfo {
  rtt: number | null;
  items: Record<string, number>;
  mySlot: number;
  mode: 'local' | 'online';
  paused: boolean;
}

const ALLY_KEYS = ['default', 'p2', 'p3', 'p4'];
const ITEM_SKUS = CATALOG.filter((i) => i.effect && !i.atStart).map((i) => i.sku);

/** DOM overlay: stage, enemies remaining, per-player lives + score, effect timers, RTT, pause, consumables. */
export class Hud {
  readonly el: HTMLElement;
  private stageEl: HTMLElement;
  private enemiesEl: HTMLElement;
  private livesEl: HTMLElement;
  private effectsEl: HTMLElement;
  private rttEl: HTMLElement;
  private timeEl: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private itemsEl: HTMLElement;
  private itemButtons = new Map<string, { btn: HTMLButtonElement; count: HTMLElement }>();
  private last = { stage: -1, enemies: -1, lives: '', effects: '', rtt: -2, items: '', time: -1, paused: false };
  /** slot -> time the "life gained" highlight expires. */
  private pulses = new Map<number, number>();

  constructor(private cb: HudCallbacks) {
    this.stageEl = h('div', { class: 'hud-stage', dataset: { testid: 'hud-stage' } });
    this.enemiesEl = h('div', { class: 'hud-enemies', dataset: { testid: 'hud-enemies' }, attrs: { 'aria-label': t('hud.enemies') } });
    this.livesEl = h('div', { class: 'hud-lives', dataset: { testid: 'hud-lives' } });
    this.effectsEl = h('div', { class: 'hud-effects' });
    this.rttEl = h('div', { class: 'hud-rtt', dataset: { testid: 'hud-rtt' } });
    this.timeEl = h('div', { class: 'hud-time' });
    this.pauseBtn = h('button', { class: 'hud-btn hud-pause', type: 'button', dataset: { testid: 'hud-pause' }, attrs: { 'aria-label': t('hud.pause') }, onclick: () => cb.onPause() }, '❚❚');
    this.itemsEl = h('div', { class: 'hud-items', dataset: { testid: 'hud-items' } });
    for (const sku of ITEM_SKUS) {
      const item = CATALOG.find((i) => i.sku === sku)!;
      const count = h('span', { class: 'hud-item-count' }, '0');
      const btn = h(
        'button',
        { class: 'hud-btn hud-item', type: 'button', dataset: { testid: `hud-item-${sku}`, sku }, attrs: { 'aria-label': item.name }, onclick: () => cb.onUseItem(sku) },
        h('span', { class: 'hud-item-icon' }, item.icon),
        count,
      );
      btn.hidden = true;
      this.itemButtons.set(sku, { btn, count });
      this.itemsEl.appendChild(btn);
    }
    this.el = h(
      'div',
      { class: 'hud', dataset: { testid: 'hud' } },
      h('div', { class: 'hud-row hud-top' }, this.stageEl, this.enemiesEl, this.timeEl, this.rttEl, this.pauseBtn),
      h('div', { class: 'hud-row hud-bottom' }, this.livesEl, this.effectsEl, this.itemsEl),
    );
  }

  /** Highlights a player's life counter for a moment — used when an extra life lands. */
  pulseLives(slot: number): void {
    this.pulses.set(slot, performance.now() + 1200);
  }

  update(view: ViewState, info: HudInfo): void {
    const L = this.last;
    if (view.stage !== L.stage) {
      L.stage = view.stage;
      this.stageEl.textContent = `${t('hud.stage')} ${view.stage}`;
      this.stageEl.dataset.stage = String(view.stage);
    }
    const remaining = view.mode === 'versus' ? 0 : Math.max(0, view.enemies.total - view.enemies.killed);
    if (remaining !== L.enemies) {
      L.enemies = remaining;
      clear(this.enemiesEl);
      this.enemiesEl.dataset.count = String(remaining);
      this.enemiesEl.title = `${t('hud.enemies')}: ${remaining}`;
      const shown = Math.min(remaining, 20);
      for (let i = 0; i < shown; i++) this.enemiesEl.appendChild(h('i', { class: 'enemy-icon' }));
      if (remaining > shown) this.enemiesEl.appendChild(h('span', { class: 'enemy-more' }, `+${remaining - shown}`));
    }
    // The chip is rebuilt whenever any of these change, so the pulse has to live in the key too or
    // the rebuild triggered by the life itself would drop the class before it ever animated.
    const now = performance.now();
    for (const [slot, until] of this.pulses) if (until <= now) this.pulses.delete(slot);
    const livesKey =
      view.players
        .map((p) => `${p.slot}:${p.name}:${p.lives}:${p.score}:${p.active}:${p.skin}:${p.kills}:${p.team}:${this.pulses.has(p.slot) ? 1 : 0}`)
        .join('|') +
      info.mySlot +
      view.versusFormat;
    if (livesKey !== L.lives) {
      L.lives = livesKey;
      clear(this.livesEl);
      for (const p of view.players) {
        if (!p.active) continue;
        const skin = SKINS[p.skin && p.skin !== 'default' ? p.skin : ALLY_KEYS[p.slot] ?? 'default'] ?? SKINS.default;
        const isMe = p.slot === info.mySlot;
        this.livesEl.appendChild(
          h(
            'div',
            {
              class:
                `hud-player${isMe ? ' me' : ''}${this.pulses.has(p.slot) ? ' gained' : ''}` +
                (view.versusFormat === 'teams' && p.team >= 0 ? ` team-${p.team}` : '') +
                (view.mode === 'versus' && p.lives <= 0 ? ' out' : ''),
              style: { '--pc': skin.primary } as unknown as Partial<CSSStyleDeclaration>,
              dataset: { slot: String(p.slot), lives: String(p.lives) },
            },
            h('span', { class: 'hud-player-name' }, isMe && info.mode === 'local' ? t('common.you') : p.name || `P${p.slot + 1}`),
            // Versus lives are now finite, so they matter as much as the kill count: show both.
            h(
              'span',
              { class: 'hud-player-lives', attrs: { 'aria-label': t('hud.lives') } },
              view.mode === 'versus' ? `♥ ${p.lives} · ☠ ${p.kills}` : `♥ ${p.lives}`,
            ),
            h('span', { class: 'hud-player-score' }, p.score.toLocaleString()),
          ),
        );
      }
    }
    const fx: string[] = [];
    if (view.effects.freeze > 0) fx.push(`${t('hud.freeze')} ${Math.ceil(view.effects.freeze / TICK_RATE)}s`);
    if (view.effects.shovel > 0) fx.push(`${t('hud.shovel')} ${Math.ceil(view.effects.shovel / TICK_RATE)}s`);
    const fxKey = fx.join('|');
    if (fxKey !== L.effects) {
      L.effects = fxKey;
      clear(this.effectsEl);
      for (const f of fx) this.effectsEl.appendChild(h('span', { class: 'hud-chip' }, f));
    }
    const rtt = info.rtt ?? -1;
    if (rtt !== L.rtt) {
      L.rtt = rtt;
      this.rttEl.hidden = rtt < 0;
      this.rttEl.textContent = rtt >= 0 ? `${rtt} ms` : '';
      this.rttEl.className = `hud-rtt ${rtt > 180 ? 'bad' : rtt > 90 ? 'warn' : 'good'}`;
    }
    const time = view.mode === 'versus' ? Math.max(0, Math.ceil(view.timeLeft / TICK_RATE)) : -1;
    if (time !== L.time) {
      L.time = time;
      this.timeEl.hidden = time < 0;
      this.timeEl.textContent = time >= 0 ? `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}` : '';
    }
    const itemsKey = ITEM_SKUS.map((s) => `${s}=${info.items[s] ?? 0}`).join(',') + (view.status === 'gameOver' ? 'go' : '');
    if (itemsKey !== L.items) {
      L.items = itemsKey;
      for (const [sku, { btn, count }] of this.itemButtons) {
        const n = info.items[sku] ?? 0;
        const isRevive = sku === 'revive_token';
        btn.hidden = n <= 0 || view.mode === 'versus' || (isRevive && view.status !== 'gameOver') || (!isRevive && view.status === 'gameOver');
        count.textContent = String(n);
        btn.disabled = n <= 0;
      }
    }
    if (info.paused !== L.paused) {
      L.paused = info.paused;
      this.pauseBtn.textContent = info.paused ? '▶' : '❚❚';
      this.pauseBtn.setAttribute('aria-label', info.paused ? t('hud.resume') : t('hud.pause'));
    }
  }
}
