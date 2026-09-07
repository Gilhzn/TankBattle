import type { Logger } from '../util/log.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly name: string;
  send(mail: Mail): Promise<void>;
}

/**
 * The fallback when no mail provider is configured: the message is logged instead of sent, so a
 * developer (or a self-hosted operator kicking the tyres) can read the code off the server log and
 * complete the flow. Never appropriate in production — `createMailer` warns when it picks this.
 */
export class ConsoleMailer implements Mailer {
  readonly name = 'console';
  constructor(private readonly log: Logger) {}

  async send(mail: Mail): Promise<void> {
    this.log.warn(`[mail:console] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
  }
}

export interface HttpMailerOptions {
  /** 'resend' and 'sendgrid' set the endpoint and body shape; 'custom' posts {to,subject,text,html}. */
  provider: 'resend' | 'sendgrid' | 'custom';
  apiKey: string;
  from: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Sends through a transactional email API over HTTPS. Chosen over SMTP because it needs no long
 * lived connection, no TLS negotiation of our own and no extra dependency — one POST per message.
 */
export class HttpMailer implements Mailer {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpMailerOptions) {
    this.name = opts.provider;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private request(mail: Mail): { url: string; headers: Record<string, string>; body: string } {
    const { provider, apiKey, from } = this.opts;
    const auth = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    if (provider === 'sendgrid') {
      return {
        url: this.opts.endpoint ?? 'https://api.sendgrid.com/v3/mail/send',
        headers: auth,
        body: JSON.stringify({
          personalizations: [{ to: [{ email: mail.to }] }],
          from: { email: from },
          subject: mail.subject,
          content: [{ type: 'text/plain', value: mail.text }, ...(mail.html ? [{ type: 'text/html', value: mail.html }] : [])],
        }),
      };
    }
    if (provider === 'resend') {
      return {
        url: this.opts.endpoint ?? 'https://api.resend.com/emails',
        headers: auth,
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      };
    }
    return {
      url: this.opts.endpoint ?? '',
      headers: auth,
      body: JSON.stringify({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
    };
  }

  async send(mail: Mail): Promise<void> {
    const { url, headers, body } = this.request(mail);
    if (!url) throw new Error('mailer: no endpoint configured');
    const res = await this.fetchImpl(url, { method: 'POST', headers, body });
    if (!res.ok) {
      // The provider's body usually says exactly what is wrong (unverified sender, bad key); it is
      // worth carrying into the log, but it must not reach the client.
      const detail = await res.text().catch(() => '');
      throw new Error(`mailer ${this.name} refused the message (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}

export interface MailerConfig {
  provider?: string;
  apiKey?: string;
  from?: string;
  endpoint?: string;
}

/** Builds the configured mailer, falling back to the console one with a warning. */
export function createMailer(cfg: MailerConfig, log: Logger, fetchImpl?: typeof fetch): Mailer {
  const provider = (cfg.provider ?? '').toLowerCase();
  if (provider === 'resend' || provider === 'sendgrid' || provider === 'custom') {
    if (!cfg.apiKey || !cfg.from) {
      log.warn(`MAIL_PROVIDER=${provider} needs MAIL_API_KEY and MAIL_FROM; falling back to console mail`);
      return new ConsoleMailer(log);
    }
    return new HttpMailer({ provider, apiKey: cfg.apiKey, from: cfg.from, endpoint: cfg.endpoint, fetchImpl });
  }
  log.warn('no MAIL_PROVIDER set: verification codes will be written to the server log, not emailed');
  return new ConsoleMailer(log);
}

/** The verification email itself, in both languages the game ships. */
export function verificationMail(to: string, code: string, lang: 'en' | 'he' = 'en'): Mail {
  if (lang === 'he') {
    return {
      to,
      subject: `${code} — קוד האימות שלך ל-Tank 1990`,
      text: `קוד האימות שלך הוא ${code}\n\nהקוד תקף ל-15 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.`,
    };
  }
  return {
    to,
    subject: `${code} is your Tank 1990 verification code`,
    text: `Your verification code is ${code}\n\nIt expires in 15 minutes. If you didn't ask for it, you can ignore this email.`,
  };
}
