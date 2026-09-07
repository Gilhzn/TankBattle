import type { Logger } from '../util/log.js';

/**
 * What a fill-in opponent says in match chat.
 *
 * Two implementations behind one interface: a scripted responder that always works, and an LLM one
 * used when the operator has configured an API key. The scripted one is not a fallback in the
 * apologetic sense — match chat is short, repetitive and highly patterned ("gg", "gl", "lag?",
 * "nice shot"), so a well-built table covers most of it convincingly.
 */

export interface ChatContext {
  /** What the human just said. */
  text: string;
  /** The opponent's display name, so replies can use it. */
  opponentName: string;
  /** The bot's own display name. */
  selfName: string;
  /** 'he' when the human is playing in Hebrew. */
  lang: 'en' | 'he';
  /** Who is ahead: 1 the bot, -1 the human, 0 level. */
  standing: -1 | 0 | 1;
  /** Messages already exchanged this match, so the bot does not repeat itself. */
  history: string[];
}

export interface ChatResponder {
  readonly name: string;
  /** The reply, or null to stay quiet — which is what a real player does most of the time. */
  reply(ctx: ChatContext): Promise<string | null>;
}

type Bank = Record<'en' | 'he', string[]>;

const pick = (bank: Bank, lang: 'en' | 'he', rnd: () => number, avoid: string[] = []): string => {
  const all = bank[lang];
  const fresh = all.filter((s) => !avoid.includes(s));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(rnd() * pool.length)];
};

const GREETING: Bank = {
  en: ['hey', 'yo', 'hi gl', 'gl hf', 'hey gl', 'sup'],
  he: ['היי', 'יו', 'בהצלחה', 'היי בהצלחה', 'מה קורה'],
};
const GG: Bank = {
  en: ['gg', 'gg wp', 'gg that was close', 'gg nice one', 'gg'],
  he: ['משחק טוב', 'משחק טוב היה צמוד', 'כל הכבוד', 'משחק טוב'],
};
const COMPLIMENT: Bank = {
  en: ['nice shot', 'ok that was good', 'how did you do that', 'damn', 'nice'],
  he: ['יריה יפה', 'וואו', 'איך עשית את זה', 'יפה מאוד', 'חזק'],
};
const TRASH_BACK: Bank = {
  en: ['we\'ll see', 'ok ok', 'bold', 'sure buddy', 'talk after the match'],
  he: ['נראה', 'טוב טוב', 'בטח', 'נדבר בסוף', 'חזק בפה'],
};
const WINNING: Bank = {
  en: ['getting there', 'close one', 'you almost had me', 'this map is rough'],
  he: ['מתקדם', 'היה קרוב', 'כמעט תפסת אותי', 'המפה הזאת קשה'],
};
const LOSING: Bank = {
  en: ['ok you\'re good', 'rough start for me', 'give me a second', 'you\'re fast'],
  he: ['אוקיי אתה טוב', 'התחלה גרועה שלי', 'רגע אחד', 'אתה מהיר'],
};
const LAG: Bank = {
  en: ['bit laggy here too', 'yeah my wifi is rough', 'seems ok my side'],
  he: ['גם אצלי קצת תקוע', 'הוויפי שלי גרוע', 'אצלי נראה בסדר'],
};
const AGE_OR_PLACE: Bank = {
  en: ['just playing on my phone lol', 'somewhere with bad wifi', 'why', 'haha'],
  he: ['משחק מהנייד', 'איפשהו עם ויפי גרוע', 'למה', 'חחח'],
};
/**
 * A direct "are you a bot?" gets a deflection, never a flat "no, I'm human". The opponent is
 * unlabelled by design — that is the matchmaking feature — but writing code whose job is to assert
 * it is a person to someone sincerely asking is a line worth not crossing. Deflecting is also what
 * a real player usually does with that question.
 */
const BOT_QUESTION: Bank = {
  en: ['lol', 'why do you ask', 'ha', 'do i play like one', 'focus on the game :)'],
  he: ['חחח', 'למה אתה שואל', 'הא', 'אני משחק ככה?', 'תתרכז במשחק :)'],
};
const GENERIC: Bank = {
  en: ['ha', 'yeah', 'true', 'lol', 'ok', 'hmm'],
  he: ['חחח', 'כן', 'נכון', 'אוקיי', 'המ'],
};

interface Rule {
  test: RegExp;
  bank: Bank;
  /** Chance of answering at all. Real players ignore plenty of messages. */
  chance: number;
}

/** Ordered: the first match wins, so specific patterns come before general ones. */
const RULES: Rule[] = [
  { test: /\b(bot|ai|robot|בוט|רובוט)\b/i, bank: BOT_QUESTION, chance: 0.85 },
  { test: /\b(gg|wp|good game|משחק טוב|כל הכבוד)\b/i, bank: GG, chance: 0.95 },
  { test: /\b(hi|hey|hello|yo|sup|gl|hf|היי|שלום|יו|בהצלחה)\b/i, bank: GREETING, chance: 0.8 },
  { test: /\b(lag|laggy|ping|delay|לאג|תקוע|פינג)\b/i, bank: LAG, chance: 0.8 },
  { test: /\b(nice|good|wow|damn|insane|יפה|וואו|חזק)\b/i, bank: COMPLIMENT, chance: 0.6 },
  { test: /\b(noob|ez|easy|trash|bad|scrub|נוב|קל|גרוע)\b/i, bank: TRASH_BACK, chance: 0.85 },
  { test: /\b(where|who|how old|age|from|מאיפה|מי אתה|בן כמה)\b/i, bank: AGE_OR_PLACE, chance: 0.7 },
];

export interface ScriptedResponderOptions {
  rnd?: () => number;
  /** Chance of replying when nothing more specific matched. */
  idleChance?: number;
}

/** The always-available responder: pattern-matched banks with a standing-aware default. */
export class ScriptedChatResponder implements ChatResponder {
  readonly name = 'scripted';
  private readonly rnd: () => number;
  private readonly idleChance: number;

  constructor(opts: ScriptedResponderOptions = {}) {
    this.rnd = opts.rnd ?? Math.random;
    this.idleChance = opts.idleChance ?? 0.35;
  }

  async reply(ctx: ChatContext): Promise<string | null> {
    const text = ctx.text.trim();
    if (!text) return null;
    for (const rule of RULES) {
      if (!rule.test.test(text)) continue;
      if (this.rnd() > rule.chance) return null;
      return pick(rule.bank, ctx.lang, this.rnd, ctx.history);
    }
    if (this.rnd() > this.idleChance) return null;
    // Nothing matched: say something that at least fits how the match is going.
    const bank = ctx.standing > 0 ? WINNING : ctx.standing < 0 ? LOSING : GENERIC;
    return pick(bank, ctx.lang, this.rnd, ctx.history);
  }

  /** An opening line, sent shortly after the match starts. */
  opener(lang: 'en' | 'he'): string {
    return pick(GREETING, lang, this.rnd);
  }

  /** A closing line, sent when the match ends. */
  closer(lang: 'en' | 'he'): string {
    return pick(GG, lang, this.rnd);
  }
}

export interface LlmResponderOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  log: Logger;
  fallback: ChatResponder;
}

/**
 * Uses an LLM for replies when the operator configures a key, falling back to the scripted
 * responder on any error — a chat reply is never worth failing a match over.
 */
export class LlmChatResponder implements ChatResponder {
  readonly name = 'llm';

  constructor(private readonly opts: LlmResponderOptions) {}

  async reply(ctx: ChatContext): Promise<string | null> {
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(this.opts.endpoint ?? 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.opts.model ?? 'claude-haiku-4-5-20251001',
          max_tokens: 40,
          system:
            'You are a casual player in a fast online tank game, chatting mid-match. Reply in at most ' +
            'eight words, lowercase, no punctuation beyond the odd "?" — the way someone types between ' +
            `rounds. Language: ${ctx.lang === 'he' ? 'Hebrew' : 'English'}. ` +
            'If asked whether you are a bot or an AI, deflect with a joke; never claim to be human. ' +
            'Reply with the message only, or the single word SKIP to stay quiet.',
          messages: [{ role: 'user', content: `${ctx.opponentName}: ${ctx.text}` }],
        }),
      });
      if (!res.ok) throw new Error(`chat model returned ${res.status}`);
      const body = (await res.json()) as { content?: Array<{ text?: string }> };
      const text = (body.content ?? []).map((c) => c.text ?? '').join('').trim();
      if (!text || text.toUpperCase() === 'SKIP') return null;
      return text.slice(0, 140);
    } catch (err) {
      this.opts.log.debug('bot chat model unavailable, using scripted replies', err);
      return this.opts.fallback.reply(ctx);
    }
  }
}

/**
 * How long the bot "spends typing" before a reply lands. Instant answers are the loudest tell there
 * is, so the delay scales with the length of what it is about to send, with a floor of about a
 * second of reading time.
 */
export function typingDelayMs(reply: string, rnd: () => number = Math.random): number {
  const perChar = 45 + rnd() * 55;
  return Math.round(700 + rnd() * 900 + reply.length * perChar);
}
