import { CATALOG_BY_SKU, SKINS, type CatalogItem } from '@tank/shared';
import { h, clear, type Child } from '../app/h.js';
import { navigate } from '../app/router.js';
import { app, dismissToast, type AppState } from '../app/store.js';
import { sfx } from '../audio/sfx.js';
import { t, itemName } from '../i18n/index.js';
import { drawTankSprite } from '../render/sprites.js';

export interface ScreenShell {
  el: HTMLElement;
  body: HTMLElement;
  header: HTMLElement;
}

/** Standard screen chrome: sticky glass header with back button + title, scrollable body. */
export function screenShell(title: string, opts: { back?: string; right?: Child; testid?: string; className?: string } = {}): ScreenShell {
  const header = h(
    'header',
    { class: 'screen-header glass' },
    opts.back !== undefined
      ? h('button', { class: 'btn icon back', type: 'button', attrs: { 'aria-label': t('common.back') }, dataset: { testid: 'back' }, onclick: () => navigate(opts.back!) }, h('span', { class: 'chev' }))
      : h('span', { class: 'header-spacer' }),
    h('h1', { class: 'screen-title' }, title),
    h('div', { class: 'header-right' }, opts.right ?? null),
  );
  const body = h('div', { class: 'screen-body' });
  const el = h('section', { class: `screen ${opts.className ?? ''}`, dataset: opts.testid ? { testid: opts.testid } : undefined }, header, body);
  return { el, body, header };
}

export function button(label: Child, opts: { kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'info' | 'confirm'; testid?: string; onClick?: (e: MouseEvent) => void; disabled?: boolean; className?: string; big?: boolean; type?: 'button' | 'submit' } = {}): HTMLButtonElement {
  const b = h(
    'button',
    {
      class: `btn ${opts.kind ?? 'secondary'} ${opts.big ? 'big' : ''} ${opts.className ?? ''}`,
      type: opts.type ?? 'button',
      dataset: opts.testid ? { testid: opts.testid } : undefined,
      disabled: !!opts.disabled,
      onclick: (e: MouseEvent) => {
        sfx.play('click');
        opts.onClick?.(e);
      },
    },
    label,
  );
  return b;
}

export function panel(...children: Child[]): HTMLElement {
  return h('div', { class: 'panel glass' }, ...children);
}

export function tabs<T extends string>(items: Array<{ id: T; label: string; testid?: string }>, active: T, onChange: (id: T) => void): HTMLElement {
  const el = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
  const render = (cur: T): void => {
    clear(el);
    for (const it of items) {
      el.appendChild(
        h(
          'button',
          {
            class: `tab ${it.id === cur ? 'active' : ''}`,
            type: 'button',
            attrs: { role: 'tab', 'aria-selected': it.id === cur ? 'true' : 'false' },
            dataset: it.testid ? { testid: it.testid } : undefined,
            onclick: () => {
              if (it.id === cur) return;
              render(it.id);
              onChange(it.id);
            },
          },
          it.label,
        ),
      );
    }
  };
  render(active);
  return el;
}

export interface Modal {
  el: HTMLElement;
  close: () => void;
}

export function modal(content: Child, opts: { testid?: string; onClose?: () => void; dismissible?: boolean } = {}): Modal {
  const box = h('div', { class: 'modal glass', attrs: { role: 'dialog', 'aria-modal': 'true' } }, content);
  const backdrop = h('div', { class: 'modal-backdrop', dataset: opts.testid ? { testid: opts.testid } : undefined }, box);
  const close = (): void => {
    backdrop.classList.add('out');
    window.setTimeout(() => backdrop.remove(), 200);
    opts.onClose?.();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && opts.dismissible !== false) close();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && opts.dismissible !== false) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  return { el: backdrop, close };
}

export function spinner(): HTMLElement {
  return h('div', { class: 'spinner', attrs: { 'aria-label': t('common.loading') } });
}

export function emptyState(text: string): HTMLElement {
  return h('div', { class: 'empty' }, text);
}

export function offlineNotice(text = t('store.offline')): HTMLElement {
  return h('div', { class: 'notice offline', dataset: { testid: 'offline-notice' } }, h('span', { class: 'dot' }), text);
}

/** Coins / gems chip bound to the store. Returns an element that updates itself; call the returned cleanup on unmount. */
export function walletChip(): { el: HTMLElement; dispose: () => void } {
  const coins = h('span', { class: 'wallet-coins', dataset: { testid: 'wallet-coins' } });
  const gems = h('span', { class: 'wallet-gems', dataset: { testid: 'wallet-gems' } });
  const el = h('div', { class: 'wallet-chip glass' }, h('span', { class: 'coin-icon' }), coins, h('span', { class: 'gem-icon' }), gems);
  const update = (s: AppState): void => {
    coins.textContent = s.wallet.coins.toLocaleString();
    gems.textContent = s.wallet.gems.toLocaleString();
    el.classList.toggle('offline', !s.online);
  };
  update(app.get());
  const dispose = app.subscribe(update);
  return { el, dispose };
}

export function priceText(item: CatalogItem, currency: 'coins' | 'gems' | 'usd'): string {
  const p = item.prices[currency];
  if (p === undefined) return '';
  if (currency === 'usd') return t('store.usd', { price: (p / 100).toFixed(2) });
  return `${p.toLocaleString()} ${currency === 'coins' ? t('common.coins') : t('common.gems')}`;
}

export function itemIcon(sku: string, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const item = CATALOG_BY_SKU[sku];
  if (item?.kind === 'cosmetic' && SKINS[sku]) return tankPreview(sku, size === 'lg' ? 96 : 40);
  return h('span', { class: `item-icon ${size}`, attrs: { 'aria-hidden': 'true' } }, item?.icon ?? '▣');
}

export function displayName(sku: string): string {
  return itemName(sku, CATALOG_BY_SKU[sku]?.name ?? sku);
}

/** Live canvas preview of a tank drawn in a skin (used in the garage / store / menu). */
export function tankPreview(skin: string, cssSize: number, opts: { animate?: boolean; tier?: number } = {}): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'tank-preview', width: Math.round(cssSize * dpr), height: Math.round(cssSize * dpr), style: { width: `${cssSize}px`, height: `${cssSize}px` } });
  const ctx = c.getContext('2d');
  const palette = SKINS[skin] ?? SKINS.default;
  if (!ctx) return c;
  let frame = 0;
  const draw = (): void => {
    ctx.clearRect(0, 0, c.width, c.height);
    drawTankSprite(ctx, c.width, { palette, frame, tier: opts.tier ?? 0, isPlayer: true });
  };
  draw();
  if (opts.animate) {
    let last = 0;
    const loop = (now: number): void => {
      if (!c.isConnected && last) return;
      if (now - last > 120) {
        last = now;
        frame = frame ? 0 : 1;
        draw();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return c;
}

export function rewardLabel(r: { coins?: number; gems?: number; items?: Record<string, number> } | null | undefined): string {
  if (!r) return '—';
  const parts: string[] = [];
  if (r.coins) parts.push(`${r.coins} ${t('common.coins')}`);
  if (r.gems) parts.push(`${r.gems} ${t('common.gems')}`);
  if (r.items) for (const [sku, n] of Object.entries(r.items)) parts.push(`${n}× ${displayName(sku)}`);
  return parts.join(' + ');
}

export function rewardIcon(r: { coins?: number; gems?: number; items?: Record<string, number> } | null | undefined): HTMLElement {
  if (!r) return h('span', { class: 'item-icon sm' }, '—');
  if (r.items) return itemIcon(Object.keys(r.items)[0]);
  if (r.gems) return h('span', { class: 'gem-icon lg' });
  return h('span', { class: 'coin-icon lg' });
}

/** Mounted once; renders app.toasts. */
export function toastHost(): HTMLElement {
  const el = h('div', { class: 'toast-host', dataset: { testid: 'toasts' } });
  const render = (s: AppState): void => {
    clear(el);
    for (const tst of s.toasts) {
      el.appendChild(
        h(
          'div',
          { class: `toast ${tst.kind}`, attrs: { role: 'status' } },
          h('span', null, tst.text),
          tst.action ? h('button', { class: 'btn small accent', type: 'button', onclick: () => { tst.action!.run(); dismissToast(tst.id); } }, tst.action.label) : null,
          h('button', { class: 'btn icon small', type: 'button', attrs: { 'aria-label': t('common.close') }, onclick: () => dismissToast(tst.id) }, '×'),
        ),
      );
    }
  };
  render(app.get());
  app.select((s) => s.toasts, () => render(app.get()));
  return el;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
}

export function labelled(label: string, control: Child, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, testid?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, dataset: testid ? { testid } : undefined, onchange: () => onChange(input.checked) });
  return h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-knob' })));
}
