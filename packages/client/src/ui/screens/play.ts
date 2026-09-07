import { matchRewards, type BoostEffect } from '@tank/shared';
import { Api, ApiError, applyWallet, queueSoloResult, refreshQuietly, type SoloResultBody } from '../../app/api.js';
import { h } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { settings } from '../../app/settings.js';
import { app, ownedQty, toast } from '../../app/store.js';
import { GameView } from '../../game/gameView.js';
import { t } from '../../i18n/index.js';
import { LocalGameHost } from '../../net/localHost.js';
import { spinner } from '../components.js';
import { showResults } from './results.js';

/** Solo play: runs the shared simulation in-browser (works fully offline). */
export async function playScreen(root: HTMLElement): Promise<() => void> {
  const wrap = h('div', { class: 'play-root', dataset: { testid: 'play' } }, h('div', { class: 'center' }, spinner()));
  root.appendChild(wrap);
  let disposed = false;
  let host: LocalGameHost | null = null;
  let view: GameView | null = null;
  let disposeResults: (() => void) | null = null;

  const s = app.get();
  const loadout = settings.get().soloLoadout.filter((sku) => ownedQty(sku) > 0).slice(0, 3);
  let soloId: string | null = null;
  let seed = (Math.random() * 0x7fffffff) | 0;
  let stage = 1;
  let boosts: BoostEffect[] = [];
  if (s.online) {
    try {
      const res = await Api.soloStart(loadout, 1);
      soloId = res.soloId;
      seed = res.seed;
      stage = res.stage;
      boosts = res.boosts;
      applyWallet(undefined, res.inventory);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) app.set({ online: false });
      else toast((e as Error).message ?? t('common.error'), 'error');
    }
  }
  if (disposed) return () => undefined;

  const nickname = s.user?.nickname || settings.get().nickname || 'Player';
  host = new LocalGameHost({ seed, stage, players: [{ id: s.user?.id ?? 'local', name: nickname, skin: s.user?.skin ?? 'default' }], mode: 'coop', boosts });
  const startedAt = Date.now();

  const finish = async (): Promise<void> => {
    if (!host || !view) return;
    host.pause();
    const me = view.view.players[0];
    const score = me?.score ?? 0;
    const kills = me?.kills ?? 0;
    const stageReached = view.view.stage;
    const stagesCleared = Math.max(0, stageReached - stage);
    const est = matchRewards(score, stagesCleared, kills, false);
    const body: SoloResultBody = { soloId: soloId ?? '', inputs: host.inputs, commands: host.commands, claimedScore: score, claimedStage: stageReached };
    let coins = est.coins;
    let xp = est.xp;
    let verified: boolean | null = null;
    let unsynced = !soloId;
    if (soloId) {
      try {
        const res = await Api.soloResult(body);
        coins = res.coins;
        xp = res.xp;
        verified = res.verified;
        applyWallet(res.wallet);
        app.set({ battlepass: res.battlepass });
        void refreshQuietly();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          queueSoloResult(body);
          unsynced = true;
        } else {
          verified = false;
          toast((e as Error).message, 'error');
        }
      }
    }
    if (disposed) return;
    disposeResults = showResults(wrap, {
      mode: 'solo',
      won: false,
      score,
      kills,
      stage: stageReached,
      coins,
      xp,
      verified,
      unsynced,
      onPlayAgain: () => navigate('/play'),
      onMenu: () => navigate('/'),
    });
    void startedAt;
  };

  view = new GameView({
    transport: host,
    onGameOver: () => void finish(),
    onQuit: () => navigate('/'),
  });
  wrap.replaceChildren();
  view.mount(wrap);
  host.start();

  return () => {
    disposed = true;
    disposeResults?.();
    view?.destroy();
    host?.stop();
    wrap.remove();
  };
}
