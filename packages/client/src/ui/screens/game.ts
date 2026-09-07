import type { ServerMessage } from '@tank/shared';
import { refreshQuietly } from '../../app/api.js';
import { h } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { GameView } from '../../game/gameView.js';
import { t } from '../../i18n/index.js';
import { ws } from '../../net/wsClient.js';
import { spinner } from '../components.js';
import { showResults } from './results.js';

/** Online match: the server runs the simulation; we render snapshots through the WsClient transport. */
export function gameScreen(root: HTMLElement): () => void {
  if (!ws.room || !ws.lastGameStart) {
    navigate('/lobby', true);
    return () => undefined;
  }
  const wrap = h('div', { class: 'play-root', dataset: { testid: 'game' } });
  root.appendChild(wrap);
  let disposeResults: (() => void) | null = null;
  const waiting = h('div', { class: 'center waiting' }, spinner(), h('p', null, t('game.waiting')));

  const view = new GameView({
    transport: ws,
    onGameOver: (info) => {
      const me = info.results?.find((r) => r.playerId === ws.playerId);
      const mode = info.view.mode;
      disposeResults = showResults(wrap, {
        mode,
        won: !!me?.won,
        score: me?.score ?? info.view.players[ws.mySlot]?.score ?? 0,
        kills: me?.kills ?? 0,
        stage: me?.stageReached ?? info.view.stage,
        coins: me?.coins ?? 0,
        xp: me?.xp ?? 0,
        verified: true,
        unsynced: false,
        results: info.results,
        myId: ws.playerId,
        playAgainLabel: t('results.backToLobby'),
        onPlayAgain: () => navigate('/lobby'),
        onMenu: () => {
          ws.leaveRoom();
          navigate('/');
        },
      });
      void refreshQuietly();
    },
    onQuit: () => {
      ws.leaveRoom();
      navigate('/');
    },
  });
  view.mount(wrap);
  view.pushSnapshot(ws.lastGameStart.snapshot);

  const onServer = (msg: ServerMessage): void => {
    switch (msg.type) {
      case 'walletUpdate':
        app.set({ wallet: { coins: msg.coins, gems: msg.gems } });
        break;
      case 'kicked':
        toast(msg.reason, 'error');
        navigate('/lobby');
        break;
      case 'left':
        navigate('/lobby');
        break;
      case 'gameStart':
        // a new match started from the lobby while we were still here (e.g. host restarted quickly)
        disposeResults?.();
        disposeResults = null;
        break;
      case 'roomState':
        if (msg.status === 'lobby' && !disposeResults) {
          // match ended without results (e.g. everyone left) → back to the lobby
          navigate('/lobby');
        }
        break;
    }
  };
  const unsubServer = ws.server.on(onServer);
  const unsubState = ws.stateChanged.on((s) => {
    if (s === 'closed') {
      toast(t('lobby.disconnected'), 'error');
      navigate('/lobby');
    }
  });
  waiting.remove();

  return () => {
    unsubServer();
    unsubState();
    disposeResults?.();
    view.destroy();
    ws.stop();
    wrap.remove();
  };
}
