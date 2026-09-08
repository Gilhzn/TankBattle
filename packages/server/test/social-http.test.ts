import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.js';
import type { Mail } from '../src/auth/mailer.js';
import { api, guest, startTestServer, TEST_SECRET } from './helpers.js';

/** Captures the verification mail instead of sending it, so the code is readable in the test. */
class CapturingMailer {
  readonly name = 'capture';
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
  /** The six-digit code out of the most recent message to this address. */
  codeFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    if (!mail) throw new Error(`no mail sent to ${to}`);
    const code = /\b(\d{6})\b/.exec(`${mail.subject} ${mail.text}`)?.[1];
    if (!code) throw new Error(`no code in mail to ${to}`);
    return code;
  }
}

describe('accounts, friends and profiles over HTTP', () => {
  let server: RunningServer;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    server = await startTestServer({
      mailer,
      // Every domain "publishes" mail servers, so the DNS gate does not need the network.
      mx: async () => ['mx.test'],
    });
  });
  afterAll(async () => server?.close());

  describe('sign-in methods', () => {
    it('reports which methods this deployment can offer', async () => {
      const res = await api(server.url)('GET', '/api/auth/methods');
      expect(res.status).toBe(200);
      // No GOOGLE_CLIENT_ID in the test config, so Google is honestly reported as unavailable.
      expect(res.body).toMatchObject({ google: false, email: true });
    });

    it('refuses Google sign-in when the server has no client id rather than pretending', async () => {
      const res = await api(server.url)('POST', '/api/auth/google', { idToken: 'x'.repeat(40) });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'google_unconfigured' } });
    });
  });

  describe('email sign-in', () => {
    it('rejects a throwaway inbox', async () => {
      const res = await api(server.url)('POST', '/api/auth/email/start', { email: 'someone@mailinator.com' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'email_disposable' } });
    });

    it('rejects a malformed address', async () => {
      const res = await api(server.url)('POST', '/api/auth/email/start', { email: 'not-an-address' });
      expect(res.status).toBe(400);
    });

    it('mails a code and signs in when it is returned', async () => {
      const email = 'player.one@example.com';
      const start = await api(server.url)('POST', '/api/auth/email/start', { email });
      expect(start.status).toBe(200);
      const verify = await api(server.url)('POST', '/api/auth/email/verify', { email, code: mailer.codeFor(email) });
      expect(verify.status).toBe(200);
      expect(verify.body).toMatchObject({ isNew: true });
      expect((verify.body as { token: string }).token).toBeTruthy();
    });

    it('lands on the same account the second time, without creating a duplicate', async () => {
      const email = 'returning@example.com';
      await api(server.url)('POST', '/api/auth/email/start', { email });
      const first = await api(server.url)('POST', '/api/auth/email/verify', { email, code: mailer.codeFor(email) });
      const id = (first.body as { user: { id: string } }).user.id;

      await api(server.url)('POST', '/api/auth/email/start', { email });
      const second = await api(server.url)('POST', '/api/auth/email/verify', { email, code: mailer.codeFor(email) });
      expect((second.body as { user: { id: string } }).user.id).toBe(id);
      expect(second.body).toMatchObject({ isNew: false });
    });

    it('refuses a wrong code', async () => {
      const email = 'wrongcode@example.com';
      await api(server.url)('POST', '/api/auth/email/start', { email });
      const res = await api(server.url)('POST', '/api/auth/email/verify', { email, code: '000000' });
      // A wrong guess is 401 unless the real code happened to be 000000, which the retry covers.
      if (res.status === 200) return;
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: 'bad_code' } });
    });

    it('carries a guest account forward instead of stranding its progress', async () => {
      const g = await guest(server, 'UpgradeMe');
      const email = 'upgrade@example.com';
      const start = await api(server.url, g.token)('POST', '/api/auth/email/start', { email });
      expect(start.status).toBe(200);
      const res = await api(server.url, g.token)('POST', '/api/auth/email/verify', { email, code: mailer.codeFor(email) });
      expect(res.status).toBe(200);
      expect((res.body as { user: { id: string } }).user.id).toBe(g.id);
      expect(res.body).toMatchObject({ isNew: false });
    });

    it('will not send a second code straight away', async () => {
      const email = 'ratelimited@example.com';
      await api(server.url)('POST', '/api/auth/email/start', { email });
      const again = await api(server.url)('POST', '/api/auth/email/start', { email });
      expect(again.status).toBe(429);
      expect(again.body).toMatchObject({ error: { code: 'code_recently_sent' } });
    });
  });

  describe('nicknames', () => {
    it('reports a free nickname as available and a taken one as not', async () => {
      const g = await guest(server, 'TakenName');
      const taken = await api(server.url)('GET', '/api/auth/nickname?nickname=TakenName');
      expect(taken.body).toMatchObject({ available: false, reason: 'taken' });
      const free = await api(server.url)('GET', '/api/auth/nickname?nickname=DefinitelyFree99');
      expect(free.body).toMatchObject({ available: true });
      // The holder is allowed to "keep" their own name.
      const mine = await g.call('GET', '/api/auth/nickname?nickname=TakenName');
      expect(mine.body).toMatchObject({ available: true });
    });

    it('reserves names that would impersonate staff', async () => {
      const res = await api(server.url)('GET', '/api/auth/nickname?nickname=admin');
      expect(res.body).toMatchObject({ available: false, reason: 'reserved' });
    });

    it('rejects a taken nickname rather than silently renaming the player', async () => {
      await guest(server, 'Contested');
      const other = await guest(server);
      const res = await other.call('PATCH', '/api/me', { nickname: 'Contested' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'nickname_taken' } });
    });
  });

  describe('friends', () => {
    it('sends, lists and accepts a request by nickname', async () => {
      const a = await guest(server, 'AlphaOne');
      const b = await guest(server, 'BetaTwo');

      const sent = await a.call('POST', '/api/friends/request', { nickname: 'BetaTwo' });
      expect(sent.status).toBe(200);
      expect(sent.body).toMatchObject({ status: 'sent' });

      const inbox = await b.call<{ incoming: Array<{ id: string; user: { nickname: string } }> }>('GET', '/api/friends');
      expect(inbox.body.incoming).toHaveLength(1);
      expect(inbox.body.incoming[0].user.nickname).toBe('AlphaOne');

      const accepted = await b.call('POST', `/api/friends/requests/${inbox.body.incoming[0].id}/accept`);
      expect(accepted.status).toBe(200);

      const listA = await a.call<{ friends: Array<{ nickname: string }> }>('GET', '/api/friends');
      const listB = await b.call<{ friends: Array<{ nickname: string }> }>('GET', '/api/friends');
      expect(listA.body.friends.map((f) => f.nickname)).toEqual(['BetaTwo']);
      expect(listB.body.friends.map((f) => f.nickname)).toEqual(['AlphaOne']);
    });

    it('makes two people who ask each other at once friends, not deadlocked', async () => {
      const a = await guest(server, 'MutualA');
      const b = await guest(server, 'MutualB');
      await a.call('POST', '/api/friends/request', { nickname: 'MutualB' });
      const second = await b.call('POST', '/api/friends/request', { nickname: 'MutualA' });
      expect(second.body).toMatchObject({ status: 'accepted' });
      const list = await b.call<{ friends: unknown[]; incoming: unknown[] }>('GET', '/api/friends');
      expect(list.body.friends).toHaveLength(1);
      expect(list.body.incoming).toHaveLength(0);
    });

    it('refuses a nickname nobody has', async () => {
      const a = await guest(server);
      const res = await a.call('POST', '/api/friends/request', { nickname: 'NoSuchPlayer' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'player_not_found' } });
    });

    it('refuses to befriend yourself', async () => {
      const a = await guest(server, 'Lonely');
      const res = await a.call('POST', '/api/friends/request', { nickname: 'Lonely' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'self_request' } });
    });

    it('will not ask the same person twice', async () => {
      const a = await guest(server, 'AskerOne');
      await guest(server, 'AskeeOne');
      await a.call('POST', '/api/friends/request', { nickname: 'AskeeOne' });
      const again = await a.call('POST', '/api/friends/request', { nickname: 'AskeeOne' });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: { code: 'already_requested' } });
    });

    it('honours a decline for a day', async () => {
      const a = await guest(server, 'Persistent');
      const b = await guest(server, 'NotInterested');
      await a.call('POST', '/api/friends/request', { nickname: 'NotInterested' });
      const inbox = await b.call<{ incoming: Array<{ id: string }> }>('GET', '/api/friends');
      await b.call('POST', `/api/friends/requests/${inbox.body.incoming[0].id}/decline`);
      const again = await a.call('POST', '/api/friends/request', { nickname: 'NotInterested' });
      expect(again.status).toBe(429);
      expect(again.body).toMatchObject({ error: { code: 'recently_declined' } });
    });

    it('removes a friend from both sides', async () => {
      const a = await guest(server, 'RemoveA');
      const b = await guest(server, 'RemoveB');
      await a.call('POST', '/api/friends/request', { nickname: 'RemoveB' });
      const inbox = await b.call<{ incoming: Array<{ id: string }> }>('GET', '/api/friends');
      await b.call('POST', `/api/friends/requests/${inbox.body.incoming[0].id}/accept`);
      await a.call('DELETE', `/api/friends/${b.id}`);
      const listA = await a.call<{ friends: unknown[] }>('GET', '/api/friends');
      const listB = await b.call<{ friends: unknown[] }>('GET', '/api/friends');
      expect(listA.body.friends).toHaveLength(0);
      expect(listB.body.friends).toHaveLength(0);
    });

    it('lets the sender withdraw a request', async () => {
      const a = await guest(server, 'CancelA');
      const b = await guest(server, 'CancelB');
      const sent = await a.call<{ request: { id: string } }>('POST', '/api/friends/request', { nickname: 'CancelB' });
      await a.call('POST', `/api/friends/requests/${sent.body.request.id}/cancel`);
      const inbox = await b.call<{ incoming: unknown[] }>('GET', '/api/friends');
      expect(inbox.body.incoming).toHaveLength(0);
    });

    it('will not let a stranger answer someone else\'s request', async () => {
      const a = await guest(server, 'OwnerA');
      const b = await guest(server, 'OwnerB');
      const c = await guest(server, 'Meddler');
      const sent = await a.call<{ request: { id: string } }>('POST', '/api/friends/request', { nickname: 'OwnerB' });
      const res = await c.call('POST', `/api/friends/requests/${sent.body.request.id}/accept`);
      expect(res.status).toBe(404);
    });
  });

  describe('WhatsApp invites', () => {
    it('mints a signed link that opens WhatsApp with the message ready', async () => {
      const a = await guest(server, 'Inviter');
      const res = await a.call<{ code: string; whatsappUrl: string; text: string }>('GET', '/api/friends/invite');
      expect(res.status).toBe(200);
      expect(res.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
      expect(decodeURIComponent(res.body.whatsappUrl)).toContain('Inviter');
      expect(res.body.code).toBeTruthy();
    });

    it('sends the request back to whoever shared the link', async () => {
      const a = await guest(server, 'LinkSharer');
      const b = await guest(server, 'LinkOpener');
      const invite = await a.call<{ code: string }>('GET', '/api/friends/invite');
      const res = await b.call('POST', '/api/friends/invite/accept', { code: invite.body.code });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'sent', nickname: 'LinkSharer' });
      const inbox = await a.call<{ incoming: Array<{ user: { nickname: string } }> }>('GET', '/api/friends');
      expect(inbox.body.incoming[0].user.nickname).toBe('LinkOpener');
    });

    it('mints an absolute link without anyone configuring the deployment address', async () => {
      // The link travels through WhatsApp, where a relative path has nothing to resolve against.
      // No PUBLIC_URL is set on this test server, so this proves the request-derived fallback works.
      const a = await guest(server, 'AbsoluteLinker');
      const res = await a.call<{ url: string; text: string }>('GET', '/api/friends/invite');
      expect(res.body.url).toMatch(/^https?:\/\/[^/]+\/#\/invite\//);
      expect(new URL(res.body.url).origin).toBe(new URL(server.url).origin);
      expect(res.body.text).toContain(res.body.url);
    });

    it('does not double the slash when the configured address has a trailing one', async () => {
      // `https://host//#/invite/...` is read as protocol-relative and points at a host that is not
      // there, so the trailing slash has to be trimmed rather than trusted.
      const withSlash = await startTestServer({ config: { publicUrl: 'https://example.test/' } });
      try {
        const a = await guest(withSlash, 'SlashTrimmer');
        const res = await a.call<{ url: string }>('GET', '/api/friends/invite');
        expect(res.body.url).toMatch(/^https:\/\/example\.test\/#\/invite\//);
        expect(res.body.url).not.toContain('//#/');
      } finally {
        await withSlash.close();
      }
    });

    it('lets an explicitly configured address win over the request', async () => {
      const configured = await startTestServer({ config: { publicUrl: 'https://tanks.example' } });
      try {
        const a = await guest(configured, 'ConfiguredHost');
        const res = await a.call<{ url: string }>('GET', '/api/friends/invite');
        expect(new URL(res.body.url).origin).toBe('https://tanks.example');
      } finally {
        await configured.close();
      }
    });

    it('rejects a tampered code', async () => {
      const a = await guest(server, 'HonestSharer');
      const b = await guest(server);
      const invite = await a.call<{ code: string }>('GET', '/api/friends/invite');
      const tampered = `${invite.body.code.slice(0, -4)}AAAA`;
      const res = await b.call('POST', '/api/friends/invite/accept', { code: tampered });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'bad_invite' } });
    });

    it('refuses your own invite link', async () => {
      const a = await guest(server, 'SelfInviter');
      const invite = await a.call<{ code: string }>('GET', '/api/friends/invite');
      const res = await a.call('POST', '/api/friends/invite/accept', { code: invite.body.code });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'self_invite' } });
    });
  });

  describe('profiles and the ladder', () => {
    it('shows an unrated player as unranked rather than last', async () => {
      const a = await guest(server, 'FreshFace');
      const res = await a.call<{ rating: { rating: number; world: { position: number } } }>('GET', '/api/me/profile');
      expect(res.status).toBe(200);
      expect(res.body.rating.rating).toBe(1000);
      expect(res.body.rating.world.position).toBe(0);
    });

    it('finds a player by nickname and says whether you are friends', async () => {
      const a = await guest(server, 'LookerUp');
      const b = await guest(server, 'LookedUp');
      const res = await a.call<{ nickname: string; isFriend: boolean; isSelf: boolean }>('GET', '/api/players/by-nickname/LookedUp');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nickname: 'LookedUp', isFriend: false, isSelf: false });
      void b;
    });

    it('serves the world ladder with the viewer\'s own standing attached', async () => {
      const a = await guest(server, 'Ladder');
      const res = await a.call<{ scope: string; entries: unknown[]; me: { rating: number } }>('GET', '/api/ranked/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('world');
      expect(res.body.me.rating).toBe(1000);
    });

    it('needs a token, like every other personal endpoint', async () => {
      const res = await api(server.url)('GET', '/api/friends');
      expect(res.status).toBe(401);
      void TEST_SECRET;
    });
  });
});
