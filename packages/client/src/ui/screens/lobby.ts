import { CATALOG_BY_SKU, type GameMode, type RoomStateMessage, type ServerMessage } from '@tank/shared';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { settings } from '../../app/settings.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { ws, type WsState } from '../../net/wsClient.js';
import { button, displayName, itemIcon, offlineNotice, panel, screenShell, spinner, tankPreview, toggle } from '../components.js';

const MAX_LOADOUT = 3;

function ownedBoosts(): string[] {
  const inv = app.get().inventory;
  return Object.keys(inv).filter((sku) => inv[sku].qty > 0 && CATALOG_BY_SKU[sku]?.kind === 'boost');
}

/** Multiplayer lobby: connect → create/join/quick play → room view (players, loadout, chat, start). */
export function lobbyScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('lobby.title'), { back: '/', testid: 'lobby' });
  root.appendChild(shell.el);
  const body = shell.body;
  let mode: GameMode = 'coop';
  let isPrivate = false;
  let loadout = settings.get().mpLoadout.filter((s) => ownedBoosts().includes(s)).slice(0, MAX_LOADOUT);
  const chatLog: Array<{ name: string; text: string }> = [];
  let countdownTimer = 0;
  let disposed = false;

  const setStatus = (text: string, kind = ''): void => {
    const el = body.querySelector('.lobby-status');
    if (el) {
      el.textContent = text;
      el.className = `lobby-status ${kind}`;
    }
  };

  const renderHome = (): void => {
    clear(body);
    const code = h('input', {
      class: 'code-input',
      type: 'text',
      inputMode: 'latin',
      autocomplete: 'off',
      autocapitalize: 'characters',
      maxLength: 5,
      placeholder: t('lobby.codePlaceholder'),
      dataset: { testid: 'lobby-join-code' },
      attrs: { 'aria-label': t('lobby.joinTitle'), spellcheck: 'false' },
      oninput: () => {
        code.value = code.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
        joinBtn.disabled = code.value.length !== 5;
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' && code.value.length === 5) joinBtn.click();
      },
    });
    const joinBtn = button(t('lobby.join'), {
      kind: 'primary',
      big: true,
      testid: 'lobby-join',
      disabled: true,
      onClick: () => {
        setStatus(t('common.loading'));
        ws.joinRoom(code.value, mode === 'versus' ? [] : loadout);
      },
    });
    const modeTabs = h(
      'div',
      { class: 'seg', attrs: { role: 'radiogroup' } },
      ...(['coop', 'versus'] as GameMode[]).map((m) =>
        h('button', { class: `seg-btn ${m === mode ? 'active' : ''}`, type: 'button', dataset: { testid: `lobby-mode-${m}` }, attrs: { role: 'radio', 'aria-checked': m === mode ? 'true' : 'false' }, onclick: () => { mode = m; renderHome(); } }, t(`lobby.${m}`)),
      ),
    );
    body.append(
      h('div', { class: 'lobby-status', dataset: { testid: 'lobby-status' } }),
      panel(
        h('h2', null, t('lobby.create')),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('lobby.mode')), modeTabs),
        h('label', { class: 'field row-field' }, h('span', null, t('lobby.private'), h('small', { class: 'muted' }, t('lobby.privateHint'))), toggle(isPrivate, (v) => (isPrivate = v), 'lobby-private')),
        button(t('lobby.create'), { kind: 'primary', big: true, testid: 'lobby-create', onClick: () => { setStatus(t('common.loading')); ws.createRoom(mode, isPrivate, mode === 'versus' ? [] : loadout); } }),
      ),
      panel(h('h2', null, t('lobby.joinTitle')), h('div', { class: 'join-row' }, code, joinBtn)),
      panel(
        h('h2', null, t('lobby.quickPlay')),
        h('p', { class: 'muted' }, t('lobby.quickPlayHint')),
        button(`${t('lobby.quickPlay')} · ${t(`lobby.${mode}`)}`, { kind: 'accent', big: true, testid: 'lobby-quick', onClick: () => { setStatus(t('common.loading')); ws.quickPlay(mode, mode === 'versus' ? [] : loadout); } }),
      ),
    );
  };

  const renderRoom = (room: RoomStateMessage): void => {
    clear(body);
    const me = room.players.find((p) => p.id === ws.playerId);
    const isHost = room.hostId === ws.playerId;
    const allReady = room.players.every((p) => p.ready || p.id === room.hostId);
    // the host may start at any time (the server allows it); readiness is a courtesy signal for co-op
    const canStart = isHost && room.status === 'lobby' && room.players.length >= 1;
    const shareText = t('lobby.shareText', { code: room.code });
    const copyBtn = button(t('common.copy'), {
      kind: 'ghost',
      className: 'small',
      testid: 'lobby-copy',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(room.code);
          toast(t('common.copied'), 'success');
        } catch {
          toast(room.code, 'info');
        }
      },
    });
    const shareBtn = typeof navigator.share === 'function' ? button(t('common.share'), { kind: 'ghost', className: 'small', testid: 'lobby-share', onClick: () => navigator.share({ title: t('app.title'), text: shareText }).catch(() => undefined) }) : null;

    const playersEl = h(
      'div',
      { class: 'player-list', dataset: { testid: 'lobby-players' } },
      ...room.players.map((p) =>
        h(
          'div',
          { class: `player-row ${p.connected ? '' : 'disconnected'} ${p.id === ws.playerId ? 'me' : ''}`, dataset: { playerId: p.id, slot: String(p.slot) } },
          tankPreview(p.skin && p.skin !== 'default' ? p.skin : ['default', 'p2', 'p3', 'p4'][p.slot] ?? 'default', 40),
          h('div', { class: 'player-name' }, p.name, p.isHost ? h('span', { class: 'chip host' }, t('lobby.host')) : null),
          h('span', { class: `chip ${p.ready ? 'ready' : ''}` }, p.ready ? t('lobby.ready') : t('lobby.notReady')),
        ),
      ),
    );

    const owned = ownedBoosts();
    const loadoutEl = h(
      'div',
      { class: 'loadout', dataset: { testid: 'lobby-loadout' } },
      room.mode === 'versus'
        ? h('p', { class: 'muted' }, t('lobby.loadoutVersus'))
        : owned.length === 0
          ? h('p', { class: 'muted' }, t('lobby.loadoutEmpty'))
          : owned.map((sku) => {
              const selected = loadout.includes(sku);
              return h(
                'button',
                {
                  class: `chip-btn ${selected ? 'selected' : ''}`,
                  type: 'button',
                  dataset: { testid: `loadout-${sku}` },
                  onclick: () => {
                    if (selected) loadout = loadout.filter((s) => s !== sku);
                    else if (loadout.length < MAX_LOADOUT) loadout = [...loadout, sku];
                    else return;
                    settings.set({ mpLoadout: loadout });
                    ws.setLoadout(loadout);
                    renderRoom(ws.room ?? room);
                  },
                },
                itemIcon(sku),
                h('span', null, displayName(sku)),
                h('span', { class: 'muted' }, `×${app.get().inventory[sku]?.qty ?? 0}`),
              );
            }),
    );

    const chatList = h('div', { class: 'chat-log', dataset: { testid: 'lobby-chat' } }, ...chatLog.slice(-8).map((c) => h('div', { class: 'chat-line' }, h('b', null, c.name), ' ', c.text)));
    const chatInput = h('input', { class: 'chat-input', type: 'text', maxLength: 140, placeholder: t('lobby.chatPlaceholder'), dataset: { testid: 'lobby-chat-input' }, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') sendChat(); } });
    const sendChat = (): void => {
      if (!chatInput.value.trim()) return;
      ws.chat(chatInput.value);
      chatInput.value = '';
    };

    const countdown = h('div', { class: 'countdown', dataset: { testid: 'lobby-countdown' } });
    const tickCountdown = (): void => {
      if (room.status !== 'countdown' || !room.countdownEndsAt) return;
      const left = Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000));
      countdown.textContent = t('lobby.countdown', { n: left });
      countdownTimer = window.setTimeout(tickCountdown, 250);
    };
    window.clearTimeout(countdownTimer);
    tickCountdown();

    body.append(
      panel(
        h('div', { class: 'room-code-row' },
          h('div', null, h('div', { class: 'muted' }, `${t('lobby.roomCode')} · ${t(`lobby.${room.mode}`)}${room.isPrivate ? ' · ' + t('lobby.private') : ''}`), h('div', { class: 'room-code', dataset: { testid: 'lobby-code' } }, room.code)),
          h('div', { class: 'row' }, copyBtn, shareBtn),
        ),
        countdown,
      ),
      panel(h('h2', null, `${t('lobby.players')} (${room.players.length}/4)`), playersEl),
      panel(h('h2', null, t('lobby.loadout', { max: MAX_LOADOUT })), loadoutEl),
      panel(h('h2', null, t('lobby.chat')), chatList, h('div', { class: 'join-row' }, chatInput, button(t('common.send'), { kind: 'secondary', onClick: sendChat }))),
      h(
        'div',
        { class: 'lobby-actions' },
        !isHost ? button(me?.ready ? t('lobby.unready') : t('lobby.imReady'), { kind: me?.ready ? 'secondary' : 'primary', big: true, testid: 'lobby-ready', onClick: () => ws.setReady(!me?.ready) }) : null,
        isHost ? button(allReady ? t('lobby.start') : `${t('lobby.start')} ·`, { kind: 'primary', big: true, testid: 'lobby-start', disabled: !canStart, onClick: () => ws.startGame() }) : h('p', { class: 'muted' }, t('lobby.waitingHost')),
        button(t('lobby.leave'), { kind: 'ghost', testid: 'lobby-leave', onClick: () => { ws.leaveRoom(); renderHome(); } }),
      ),
    );
  };

  const renderConnecting = (state: WsState): void => {
    clear(body);
    if (state === 'closed') {
      body.append(offlineNotice(t('lobby.offline')), button(t('common.retry'), { kind: 'primary', onClick: () => start() }));
      return;
    }
    body.append(h('div', { class: 'center' }, spinner(), h('p', null, state === 'reconnecting' ? t('lobby.reconnecting', { n: ws.attempt }) : t('lobby.connecting'))));
  };

  const onServer = (msg: ServerMessage): void => {
    if (disposed) return;
    switch (msg.type) {
      case 'roomState':
        if (ws.room) renderRoom(ws.room);
        else renderHome();
        break;
      case 'matchFound':
        toast(t('lobby.matchFound'), 'success');
        break;
      case 'gameStart':
        navigate('/game');
        break;
      case 'chat':
        chatLog.push({ name: msg.name, text: msg.text });
        if (ws.room) renderRoom(ws.room);
        break;
      case 'error':
        toast(msg.message || msg.code, 'error');
        setStatus(msg.message || msg.code, 'error');
        break;
      case 'kicked':
        toast(msg.reason, 'error');
        renderHome();
        break;
      case 'left':
        renderHome();
        break;
      case 'walletUpdate':
        app.set({ wallet: { coins: msg.coins, gems: msg.gems } });
        break;
    }
  };

  const start = async (): Promise<void> => {
    if (!app.get().booted) {
      // the guest-auth boot may still be in flight when the lobby is opened directly
      renderConnecting('connecting');
      await new Promise<void>((resolve) => {
        const unsub = app.subscribe((s) => {
          if (s.booted) {
            unsub();
            resolve();
          }
        });
      });
      if (disposed) return;
    }
    if (!app.get().online) {
      renderConnecting('closed');
      return;
    }
    renderConnecting(ws.state === 'open' ? 'connecting' : ws.state);
    try {
      await ws.connect();
    } catch {
      if (!disposed) renderConnecting('closed');
      return;
    }
    if (disposed) return;
    if (ws.room) {
      if (ws.room.status === 'playing' && ws.lastGameStart) navigate('/game');
      else renderRoom(ws.room);
    } else renderHome();
  };

  const unsubServer = ws.server.on(onServer);
  const unsubState = ws.stateChanged.on((s) => {
    if (disposed) return;
    if (s === 'reconnecting' || s === 'closed') renderConnecting(s);
  });
  void start();

  return () => {
    disposed = true;
    window.clearTimeout(countdownTimer);
    unsubServer();
    unsubState();
    shell.el.remove();
  };
}
