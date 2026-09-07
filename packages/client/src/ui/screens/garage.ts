import { CATALOG, CATALOG_BY_SKU, SKINS } from '@tank/shared';
import { Api, applyWallet, errorMessage } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { settings } from '../../app/settings.js';
import { app, toast } from '../../app/store.js';
import { t, itemDesc } from '../../i18n/index.js';
import { button, displayName, emptyState, itemIcon, panel, screenShell, tankPreview } from '../components.js';

const MAX_LOADOUT = 3;

/** Garage: inventory, equip skins/trails with a live tank preview, solo loadout picker. */
export function garageScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('garage.title'), { back: '/', testid: 'garage' });
  root.appendChild(shell.el);
  let previewSkin = app.get().user?.skin ?? 'default';
  const previewBox = h('div', { class: 'garage-preview', dataset: { testid: 'garage-preview' } });
  const skinsEl = h('div', { class: 'chip-grid', dataset: { testid: 'garage-skins' } });
  const trailsEl = h('div', { class: 'chip-grid' });
  const boostsEl = h('div', { class: 'chip-grid' });
  const loadoutEl = h('div', { class: 'chip-grid', dataset: { testid: 'garage-loadout' } });

  /** The preview is the screen's hero, but at a fixed 160px it swallowed a phone. */
  const previewSize = (): number => Math.max(96, Math.min(160, Math.round(Math.min(window.innerWidth, 520) * 0.34)));

  const renderPreview = (): void => {
    clear(previewBox);
    const pal = SKINS[previewSkin] ?? SKINS.default;
    previewBox.style.setProperty('--glow', pal.glow);
    previewBox.append(tankPreview(previewSkin, previewSize(), { animate: true, tier: 1 }), h('div', { class: 'preview-name' }, previewSkin === 'default' ? t('garage.default') : displayName(previewSkin)));
  };

  const equip = async (sku: string): Promise<void> => {
    try {
      const res = await Api.equip(sku);
      app.set({ user: res.user, inventory: res.inventory });
      toast(`${t('common.equipped')}: ${displayName(sku)}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const render = (): void => {
    const s = app.get();
    const inv = s.inventory;
    const equippedSkin = s.user?.skin ?? 'default';
    clear(skinsEl);
    const skins = ['default', ...Object.keys(inv).filter((sku) => inv[sku].qty > 0 && CATALOG_BY_SKU[sku]?.kind === 'cosmetic' && SKINS[sku])];
    for (const sku of skins) {
      const isEquipped = sku === equippedSkin || (sku === 'default' && !SKINS[equippedSkin]);
      skinsEl.appendChild(
        h(
          'button',
          { class: `chip-btn skin ${isEquipped ? 'selected' : ''} ${previewSkin === sku ? 'previewing' : ''}`, type: 'button', dataset: { testid: `skin-${sku}` }, onclick: () => { previewSkin = sku; renderPreview(); render(); } },
          tankPreview(sku, 44),
          h('span', null, sku === 'default' ? t('garage.default') : displayName(sku)),
          isEquipped ? h('span', { class: 'chip ready' }, t('common.equipped')) : h('span', { class: 'link', onclick: (e: Event) => { e.stopPropagation(); void equip(sku); } }, t('common.equip')),
        ),
      );
    }
    clear(trailsEl);
    const trails = Object.keys(inv).filter((sku) => inv[sku].qty > 0 && CATALOG_BY_SKU[sku]?.kind === 'cosmetic' && !SKINS[sku]);
    if (!trails.length) trailsEl.appendChild(emptyState(t('garage.empty')));
    for (const sku of trails) {
      trailsEl.appendChild(
        h('div', { class: `chip-btn ${inv[sku].equipped ? 'selected' : ''}` }, itemIcon(sku), h('span', null, displayName(sku)), inv[sku].equipped ? h('span', { class: 'chip ready' }, t('common.equipped')) : button(t('common.equip'), { kind: 'ghost', className: 'small', onClick: () => void equip(sku) })),
      );
    }
    clear(boostsEl);
    const boosts = CATALOG.filter((i) => i.kind === 'boost' && (inv[i.sku]?.qty ?? 0) > 0);
    if (!boosts.length) boostsEl.appendChild(emptyState(t('garage.empty')));
    for (const item of boosts) {
      boostsEl.appendChild(h('div', { class: 'chip-btn' }, itemIcon(item.sku), h('span', null, displayName(item.sku), h('small', { class: 'muted' }, itemDesc(item.sku, item.description))), h('span', { class: 'chip' }, `×${inv[item.sku].qty}`)));
    }
    clear(loadoutEl);
    const cur = settings.get().soloLoadout.filter((sku) => (inv[sku]?.qty ?? 0) > 0);
    if (!boosts.length) loadoutEl.appendChild(emptyState(t('lobby.loadoutEmpty')));
    for (const item of boosts) {
      const selected = cur.includes(item.sku);
      loadoutEl.appendChild(
        h(
          'button',
          {
            class: `chip-btn ${selected ? 'selected' : ''}`,
            type: 'button',
            dataset: { testid: `loadout-${item.sku}` },
            onclick: () => {
              let next = selected ? cur.filter((x) => x !== item.sku) : cur.length < MAX_LOADOUT ? [...cur, item.sku] : cur;
              next = next.slice(0, MAX_LOADOUT);
              settings.set({ soloLoadout: next });
              render();
            },
          },
          itemIcon(item.sku),
          h('span', null, displayName(item.sku)),
          selected ? h('span', { class: 'chip ready' }, '✓') : null,
        ),
      );
    }
  };

  shell.body.append(
    panel(h('h2', null, t('garage.preview')), previewBox),
    panel(h('h2', null, t('garage.skins')), skinsEl),
    panel(h('h2', null, t('garage.trails')), trailsEl),
    panel(h('h2', null, t('garage.boosts')), boostsEl),
    panel(h('h2', null, t('garage.soloLoadout', { max: MAX_LOADOUT })), h('p', { class: 'muted' }, t('garage.loadoutHint')), loadoutEl),
  );
  renderPreview();
  render();
  if (app.get().online) Api.inventory().then((r) => applyWallet(undefined, r.inventory)).catch(() => undefined);
  const unsub = app.subscribe(render);
  return () => {
    unsub();
    shell.el.remove();
  };
}
