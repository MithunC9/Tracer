import { axd, BROWSERS, nat, NATIVE, web, type Ctx, type Filler } from '../engine.js';
import { card, iban, personName, phoneUS, secrets, ssn, emailFor, money } from '../fake.js';
import type { Screen } from '../sim.js';

/** Clamp a sampled duration (seconds) to the remaining budget. */
export const dur = (c: Ctx, budget: number, minSec: number, maxSec: number) => Math.max(5, Math.min(budget, c.r.float(minSec, maxSec)));

/** Split a total into n random positive parts. */
export function split(c: Ctx, total: number, n: number): number[] {
  const w = Array.from({ length: n }, () => c.r.float(0.5, 1.5));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / s);
}

// ------------------------------------------------------------------ shared screens

export const gmailInbox = (c: Ctx, unread = c.r.int(0, 24)): Screen =>
  web(c, `https://mail.google.com/mail/u/0/#inbox`, `Inbox${unread ? ` (${unread})` : ''} - ${c.sim.plant(c.me.email)} - Gmail`, [
    axd(['Inbox', 'Primary', 'Promotions'], ['Compose', 'Search mail', 'Archive', 'Mark as read'], `${unread} unread. ${personName(c.r)} — Re: follow-up on last week. ${personName(c.r)} — Your receipt from Figma. Calendar: Weekly sync updated.`),
  ]);

export const gmailThread = (c: Ctx, subject: string, from: string, body: string): Screen =>
  web(c, `https://mail.google.com/mail/u/0/#inbox/FMfcgz${c.r.str(26)}`, `${subject} - ${c.me.email} - Gmail`, [
    axd([subject], ['Reply', 'Forward', 'Archive', 'More'], `${from}\n${body}`),
  ]);

export const gmailCompose = (c: Ctx, to: string, subject: string, body: string): Screen =>
  web(c, `https://mail.google.com/mail/u/0/#inbox?compose=new`, `${subject} - ${c.me.email} - Gmail`, [
    axd(['New Message'], ['To', 'Subject', 'Send', 'Attach files', 'Formatting options'], `To: ${to}\nSubject: ${subject}\n${body}`),
  ]);

export const slackScreen = (c: Ctx, org: string, channel: string, text: string): Screen =>
  nat(NATIVE.slack, `${channel} (Channel) - ${org} - Slack`, [axd([channel], ['Message', 'Threads', 'Huddle', 'Search'], text)]);

const SLACK_LINES = [
  'can someone take a look at the deck before 3?',
  'shipping cutoff moved to 4pm today',
  'lunch order going in at 12, reply with yours',
  'reminder: retro notes are in the doc',
  'thanks! that fixed it',
  'who has the login for the shared drive?',
  'client moved the call to tomorrow',
  'pushed the update, let me know',
  ':tada: we hit the target this week',
  'heads up, I am out Friday afternoon',
];

export function slackChat(org: string, channels: string[]): Filler {
  return (c, budget) => {
    const total = dur(c, budget, 60, 420);
    const n = c.r.int(1, 3);
    for (const part of split(c, total, n)) {
      const ch = c.r.pick(channels);
      let text = `${personName(c.r)}: ${c.r.pick(SLACK_LINES)}\n${personName(c.r)}: ${c.r.pick(SLACK_LINES)}`;
      if (c.r.chance(0.12)) text += `\n${personName(c.r)}: my cell is ${c.sim.plant(phoneUS(c.r))} if the call drops`;
      if (c.r.chance(0.06)) text += `\n${personName(c.r)}: email me at ${c.sim.plant(emailFor(c.r, personName(c.r), 'partnerco.io'))}`;
      c.sim.dwell(slackScreen(c, org, ch, text), part, { axEvery: [15, 50] });
    }
  };
}

export function slackPing(org: string, channels: string[]): Filler {
  return (c, budget) => {
    const ch = c.r.pick(channels);
    c.sim.dwell(slackScreen(c, org, ch, `${personName(c.r)}: ${c.r.pick(SLACK_LINES)}`), dur(c, budget, 15, 90), { axEvery: [10, 30] });
  };
}

const EMAIL_SUBJECTS = ['Re: Quick question', 'Your receipt', 'Invitation: Weekly sync', 'Re: Proposal feedback', 'Newsletter: This week in SaaS', 'Re: Contract renewal', 'Fwd: Updated timeline', 'Action required: verify your account'];

export const emailTriage: Filler = (c, budget) => {
  const total = dur(c, budget, 90, 600);
  const parts = split(c, total, c.r.int(2, 4));
  c.sim.dwell(gmailInbox(c), parts[0]!, { axEvery: [15, 40] });
  for (const part of parts.slice(1)) {
    const who = personName(c.r);
    const subj = c.r.pick(EMAIL_SUBJECTS);
    let body = `Hi, following up on our conversation. Best, ${who}`;
    const roll = c.r.next();
    if (roll < 0.25) body += `\n${who} | ${c.sim.plant(phoneUS(c.r))} | ${c.sim.plant(emailFor(c.r, who, 'clientmail.com'))}`;
    else if (roll < 0.33) body = `Your receipt. Paid with card ${c.sim.plant(card(c.r))}. Total $${money(c.r, 9, 240)}`;
    else if (roll < 0.38) body = `Wire details: IBAN ${c.sim.plant(iban(c.r, c.r.pick(['DE', 'GB', 'FR'] as const)))} reference ${c.r.int(1000, 9999)}`;
    c.sim.dwell(gmailThread(c, subj, `${who} <${c.sim.plant(emailFor(c.r, who, 'example.org'))}>`, body), part, { axEvery: [15, 45] });
  }
};

export const emailPeek: Filler = (c, budget) => {
  c.sim.dwell(gmailInbox(c), dur(c, budget, 20, 100), { axEvery: [10, 30] });
};

export const calendarPeek: Filler = (c, budget) => {
  c.sim.dwell(
    web(c, 'https://calendar.google.com/calendar/u/0/r/week', `Google Calendar - Week of November ${2 + c.day}, 2026`, [
      axd(['Week', 'November 2026'], ['Create', 'Today', 'Search'], 'Weekly sync 10:00. Focus block. 1:1. Client call.'),
    ]),
    dur(c, budget, 20, 120),
    { axEvery: [10, 40] },
  );
};

const NEWS = [
  ['https://news.ycombinator.com/', 'Hacker News'],
  ['https://www.nytimes.com/section/business', 'Business - The New York Times'],
  ['https://www.theverge.com/tech', 'Tech - The Verge'],
  ['https://medium.com/@writer/how-we-scaled-ops', 'How we scaled ops without hiring | Medium'],
  ['https://www.bbc.co.uk/news', 'BBC News - Home'],
  ['https://www.reddit.com/r/smallbusiness/', 'r/smallbusiness'],
] as const;

export const readNews: Filler = (c, budget) => {
  const total = dur(c, budget, 120, 900);
  for (const part of split(c, total, c.r.int(1, 3))) {
    const [url, title] = c.r.pick(NEWS);
    c.sim.dwell(web(c, url, title, [axd([title], ['Search', 'Menu'], 'Top stories today. Markets, tech and the economy.')]), part, { axEvery: [30, 90] });
  }
};

export const youtube: Filler = (c, budget) => {
  c.sim.dwell(
    web(c, `https://www.youtube.com/watch?v=${c.r.str(11)}`, c.r.pick(['Lo-fi beats to work to - YouTube', 'How to use pivot tables - YouTube', 'Product design critique - YouTube']), [
      axd(['YouTube'], ['Play', 'Subscribe', 'Like'], 'Up next'),
    ]),
    dur(c, budget, 180, 720),
    { axEvery: [120, 300] },
  );
};

export const coffeeBreak: Filler = (c, budget) => {
  if (budget < 400) return void c.sim.adv(Math.min(budget, 60));
  c.sim.idle(dur(c, budget, 300, 1000));
};

export const aiChat: Filler = (c, budget) => {
  const s = c.r.chance(0.5)
    ? web(c, `https://claude.ai/chat/${c.r.str(8)}-${c.r.str(4)}`, 'Claude', [axd(['Claude'], ['Send message', 'Attach'], 'Rewrite this email to be shorter and friendlier.')])
    : web(c, `https://chatgpt.com/c/${c.r.str(12)}`, 'ChatGPT', [axd(['ChatGPT'], ['Send', 'New chat'], 'Summarize this spreadsheet formula and explain VLOOKUP.')]);
  c.sim.dwell(s, dur(c, budget, 90, 480), { axEvery: [20, 60], clips: c.r.int(0, 2) });
};

/** Personal banking: excluded by default (bank_portal hosts). Planted secrets must be dropped entirely. */
export const personalBanking: Filler = (c, budget) => {
  const host = c.r.pick(['https://secure.chase.com/web/auth/dashboard#/dashboard/overview', 'https://app.mercury.com/dashboard', 'https://www.bankofamerica.com/myaccounts/']);
  c.sim.dwell(
    web(c, host, c.r.pick(['Accounts overview', 'Dashboard', 'Statements & Documents']), [
      axd(['Checking ...4421'], ['Transfer', 'Pay bills', 'Statements'], `Available balance $${money(c.r, 2000, 30000)}. Debit card ${c.sim.plant(card(c.r, 'visa'))}. Routing ${c.r.digits(9)}`),
    ]),
    dur(c, budget, 60, 300),
    { axEvery: [15, 45] },
  );
};

/** 1Password unlock then a login form with a secure field. */
export function passwordThenLogin(loginUrl: string, loginTitle: string): Filler {
  return (c, budget) => {
    c.sim.dwell(nat(NATIVE.onepassword, '1Password', [axd(['All Items'], ['Search', 'Copy password'], `Login for ${loginTitle}: ${c.sim.plant(secrets.password(c.r), true)}`)]), dur(c, budget, 8, 40), {
      axEvery: [4, 10],
      clips: 1,
    });
    const pw = c.sim.plant(secrets.password(c.r), true);
    c.sim.dwell(
      web(c, loginUrl, loginTitle, [
        axd([loginTitle], ['Email', 'Password', 'Sign in', 'Forgot?'], c.me.email),
        axd([loginTitle], ['Password'], pw, true),
      ]),
      dur(c, Math.max(10, budget - 40), 10, 45),
      { axEvery: [3, 8] },
    );
  };
}

/** Private / incognito browsing: always excluded. */
export const privateBrowsing: Filler = (c, budget) => {
  c.sim.dwell(
    web(c, c.r.pick(['https://www.webmd.com/a-to-z-guides', 'https://www.zillow.com/homes/', 'https://www.kayak.com/flights']), c.r.pick(['Search results', 'New Incognito Tab', 'Gift ideas for her']), [
      axd(['Results'], ['Search'], `contact ${c.sim.plant(phoneUS(c.r))}`),
    ], true),
    dur(c, budget, 60, 420),
    { axEvery: [20, 60] },
  );
};

export const messagesPing: Filler = (c, budget) => {
  const who = c.sim.plant(phoneUS(c.r));
  c.sim.dwell(nat(NATIVE.messages, who, [axd([who], ['iMessage'], 'running 5 min late, see you soon')]), dur(c, budget, 10, 60), { axEvery: [5, 20] });
};

export const spotify: Filler = (c, budget) => {
  c.sim.dwell(nat(NATIVE.spotify, 'Spotify Premium', [axd(['Focus Flow'], ['Play', 'Next'], 'Deep Focus playlist')]), dur(c, budget, 10, 50), { axEvery: [10, 20] });
};

export const shopping: Filler = (c, budget) => {
  c.sim.dwell(
    web(c, `https://www.amazon.com/dp/B0${c.r.str(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789')}`, 'Amazon.com: USB-C Hub, 7-in-1', [axd(['USB-C Hub'], ['Add to Cart', 'Buy Now'], 'Ships to your address. Visa ending 4421.')]),
    dur(c, budget, 120, 480),
    { axEvery: [20, 60] },
  );
};

export const linkedinBrowse: Filler = (c, budget) => {
  c.sim.dwell(web(c, 'https://www.linkedin.com/feed/', 'Feed | LinkedIn', [axd(['Feed'], ['Start a post', 'Like', 'Comment'], 'Thrilled to announce our Series A...')]), dur(c, budget, 90, 420), {
    axEvery: [20, 60],
  });
};

/** A health portal visit (excluded by default). */
export const healthPortal: Filler = (c, budget) => {
  c.sim.dwell(
    web(c, 'https://www.mychart.org/MyChart/Messages', 'MyChart - Messages', [axd(['Messages'], ['Reply'], `Patient SSN on file ${c.sim.plant(ssn(c.r))}`)]),
    dur(c, budget, 60, 240),
    { axEvery: [20, 60] },
  );
};

export const zoomScreen = (c: Ctx, title: string): Screen =>
  nat(NATIVE.zoom, 'Zoom Meeting', [
    axd(['Zoom Meeting', title], ['Mute', 'Stop Video', 'Participants', 'Share Screen', 'Chat', 'Leave'], `${title}. ${c.r.int(2, 9)} participants.`),
    axd(['Zoom Meeting'], ['Mute', 'Chat'], `${personName(c.r)} is speaking`),
  ]);

export const meetScreen = (c: Ctx, title: string): Screen =>
  web(c, `https://meet.google.com/${c.r.str(3, 'abcdefghijklmnopqrstuvwxyz')}-${c.r.str(4, 'abcdefghijklmnopqrstuvwxyz')}-${c.r.str(3, 'abcdefghijklmnopqrstuvwxyz')}`, `Meet - ${title}`, [
    axd([title], ['Turn off microphone', 'Present now', 'Leave call'], `${title}. ${personName(c.r)} is presenting`),
  ]);

export { BROWSERS };
