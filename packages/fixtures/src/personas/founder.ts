import { axd, BROWSERS, nat, NATIVE, web, type PersonaDef } from '../engine.js';
import { emailFor, money, personName, phoneUS, secrets, stableDocId } from '../fake.js';
import {
  aiChat,
  coffeeBreak,
  dur,
  emailPeek,
  emailTriage,
  gmailCompose,
  gmailInbox,
  linkedinBrowse,
  messagesPing,
  passwordThenLogin,
  personalBanking,
  privateBrowsing,
  readNews,
  slackChat,
  slackPing,
  slackScreen,
  zoomScreen,
} from './common.js';
import { figmaWork, terminalWork, vscodeWork } from './deepwork.js';

const ORG = 'Lumos';
const COMPANIES = ['Kite Analytics', 'Harbor & Pine', 'Atlas Outdoor Co', 'Bluefin Labs', 'Sundial Health', 'Orbit Fitness', 'Ferro Studio'];
const TITLES = ['Head of Operations', 'VP Finance', 'COO', 'RevOps Lead', 'Director of Customer Success'];
const slug = (s: string) => s.toLowerCase().replace(/\W+/g, '');

export const founder: PersonaDef = {
  id: 'founder',
  description:
    'Alex, solo technical founder of an early-stage B2B SaaS (San Francisco, UTC-8). Codes in VS Code, sells via LinkedIn → HubSpot → Calendly, handles support in Intercom, tracks MRR from Stripe.',
  tzOffsetHours: -8,
  browser: BROWSERS.chrome,
  me: { name: 'Alex Chen', email: 'alex@getlumos.io', domain: 'getlumos.io' },
  workflows: [
    {
      id: 'wf_lead_to_crm',
      label: 'LinkedIn lead → copy into HubSpot → email a Calendly link',
      interruptP: 0.2,
      vars: (c) => ({ lead: personName(c.r), company: c.r.pick(COMPANIES), title: c.r.pick(TITLES) }),
      steps: [
        {
          appKey: 'linkedin',
          action: 'read',
          label: 'Read the lead’s LinkedIn profile',
          minutes: [1.5, 4],
          clips: 2,
          screens: (c) => [
            web(c, `https://www.linkedin.com/in/${slug(c.v.lead!)}-${c.r.str(6, 'abcdefghijklmnopqrstuvwxyz0123456789')}/`, `${c.v.lead} | LinkedIn`, [
              axd([c.v.lead!, `${c.v.title} at ${c.v.company}`], ['Message', 'Connect', 'More', 'Contact info'], `${c.v.title} at ${c.v.company}. Contact info: ${c.sim.plant(emailFor(c.r, c.v.lead!, slug(c.v.company!) + '.com'))}`),
            ]),
          ],
        },
        {
          appKey: 'hubspot',
          action: 'compose',
          label: 'Create the contact and deal in HubSpot',
          minutes: [3, 7],
          screens: (c) => [
            web(c, `https://app.hubspot.com/contacts/${c.r.digits(8)}/objects/0-1/views/all/list`, 'Contacts | HubSpot', [
              axd(['Create contact'], ['Email', 'First name', 'Last name', 'Job title', 'Phone number', 'Create'], `${c.v.lead} ${c.v.title} ${c.v.company} ${c.sim.plant(phoneUS(c.r))}`),
            ]),
          ],
        },
        {
          appKey: 'calendly',
          action: 'copy',
          label: 'Copy the 30-min Calendly link',
          minutes: [0.5, 1.5],
          clips: 1,
          screens: (c) => [web(c, 'https://calendly.com/event_types/user/me', 'Event Types | Calendly', [axd(['My Calendly'], ['Copy link', 'Share', 'New event type'], '30 Minute Meeting · Lumos intro')])],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Send intro email with the link',
          minutes: [2, 5],
          screens: (c) => [gmailCompose(c, c.v.lead!, `Lumos <> ${c.v.company}`, `Hi ${c.v.lead!.split(' ')[0]}, saw your post about month-end chaos — grab a time here: calendly.com/alex-lumos/30min`)],
        },
      ],
    },
    {
      id: 'wf_support_to_issue',
      label: 'Intercom conversation → file GitHub issue → reply to customer',
      interruptP: 0.2,
      vars: (c) => ({ customer: personName(c.r), company: c.r.pick(COMPANIES), n: String(c.r.int(200, 420)) }),
      steps: [
        {
          appKey: 'intercom',
          action: 'read',
          label: 'Read the support conversation',
          minutes: [2, 5],
          clips: 1,
          screens: (c) => [
            web(c, `https://app.intercom.com/a/inbox/k3x9/inbox/conversation/${c.r.digits(14)}`, `${c.v.customer} | Inbox | Intercom`, [
              axd([c.v.customer!], ['Reply', 'Note', 'Close', 'Snooze'], `${c.v.customer} (${c.sim.plant(emailFor(c.r, c.v.customer!, slug(c.v.company!) + '.com'))}): The CSV export hangs on large workspaces since yesterday.`),
            ]),
          ],
        },
        {
          appKey: 'github',
          action: 'compose',
          label: 'Open a bug issue',
          minutes: [3, 8],
          screens: (c) => [web(c, 'https://github.com/getlumos/app/issues/new', 'New Issue · getlumos/app', [axd(['New issue'], ['Title', 'Labels', 'Submit new issue'], `CSV export hangs for large workspaces (reported by ${c.v.company})`)])],
        },
        {
          appKey: 'intercom',
          action: 'compose',
          label: 'Reply to the customer with an ETA',
          minutes: [2, 4],
          screens: (c) => [web(c, `https://app.intercom.com/a/inbox/k3x9/inbox/conversation/${c.r.digits(14)}`, `${c.v.customer} | Inbox | Intercom`, [axd([c.v.customer!], ['Reply', 'Send'], `Thanks for flagging! Tracking it as #${c.v.n}, fix expected this week.`)])],
        },
      ],
    },
    {
      id: 'wf_mrr_update',
      label: 'Read MRR in Stripe → update metrics sheet → post in Slack',
      interruptP: 0.15,
      steps: [
        {
          appKey: 'stripe',
          action: 'review',
          label: 'Check MRR and new subscriptions',
          minutes: [2, 5],
          clips: 2,
          screens: (c) => [
            web(c, 'https://dashboard.stripe.com/billing', 'Billing overview – Lumos – Stripe', [axd(['Billing overview'], ['MRR', 'Subscribers', 'Churn'], `MRR $${money(c.r, 18000, 26000)} New ${c.r.int(0, 6)} Churned ${c.r.int(0, 2)}`)]),
          ],
        },
        {
          appKey: 'google_sheets',
          action: 'edit',
          label: 'Update the metrics sheet',
          minutes: [3, 7],
          screens: (c) => [web(c, `https://docs.google.com/spreadsheets/d/${stableDocId('founder:metrics')}/edit#gid=0`, 'Lumos metrics 2026 - Google Sheets', [axd(['Weekly'], ['Paste', 'Chart'], 'MRR  net new  churn  runway')])],
        },
        {
          appKey: 'slack',
          action: 'compose',
          label: 'Post numbers in #metrics',
          minutes: [1, 3],
          screens: (c) => [slackScreen(c, ORG, '#metrics', `Alex Chen: MRR update — up ${c.r.int(1, 6)}% WoW :rocket:`)],
        },
      ],
    },
    {
      id: 'wf_ship_release',
      label: 'Review & merge PR on GitHub → deploy from terminal → update Linear',
      interruptP: 0.15,
      vars: (c) => ({ pr: String(c.r.int(600, 760)) }),
      steps: [
        {
          appKey: 'github',
          action: 'review',
          label: 'Review the PR',
          minutes: [4, 10],
          screens: (c) => [web(c, `https://github.com/getlumos/app/pull/${c.v.pr}/files`, `Faster CSV export by contractor · Pull Request #${c.v.pr} · getlumos/app`, [axd(['Files changed'], ['Review changes', 'Viewed'], 'src/export/csv.ts +120 −44')])],
        },
        {
          appKey: 'github',
          action: 'approve',
          label: 'Approve and merge',
          minutes: [1, 2],
          screens: (c) => [web(c, `https://github.com/getlumos/app/pull/${c.v.pr}`, `Faster CSV export · Pull Request #${c.v.pr} · getlumos/app`, [axd(['Conversation'], ['Approve', 'Squash and merge', 'Confirm'], 'All checks have passed')])],
        },
        {
          appKey: 'terminal',
          action: 'upload',
          label: 'Deploy to production',
          minutes: [3, 8],
          screens: (c) => [nat(NATIVE.iterm, 'zsh — lumos-app', [axd(['zsh — lumos-app'], ['Shell'], `$ git pull && fly deploy\n==> Building image\n--> v${c.r.int(140, 190)} deployed successfully`)])],
        },
        {
          appKey: 'linear',
          action: 'edit',
          label: 'Mark the issue done in Linear',
          minutes: [1, 3],
          screens: () => [nat(NATIVE.linear, 'LUM-212 CSV export hangs', [axd(['LUM-212'], ['Status', 'Done', 'Comment'], 'Moved to Done')])],
        },
      ],
    },
  ],
  schedule: {
    wf_lead_to_crm: [[0, 8.8], [0, 12.0], [1, 8.5], [1, 15.6], [2, 8.8], [2, 13.9], [3, 8.5], [3, 12.4], [3, 16.5], [4, 8.6], [4, 13.0], [6, 19.6]],
    wf_support_to_issue: [[0, 10.4], [0, 15.4], [1, 11.2], [2, 10.6], [2, 16.4], [3, 14.6], [4, 10.2], [5, 10.1]],
    wf_mrr_update: [[0, 9.3], [1, 9.2], [2, 9.4], [3, 9.3], [4, 9.2]],
    wf_ship_release: [[0, 16.3], [2, 15.1], [3, 16.1], [4, 15.3]],
  },
  meetings: [
    { day: 0, at: 13.5, minutes: 30, title: 'Customer call – Kite Analytics' },
    { day: 1, at: 10.0, minutes: 45, title: 'Investor update call' },
    { day: 1, at: 14.0, minutes: 30, title: 'Demo – Harbor & Pine' },
    { day: 2, at: 11.5, minutes: 30, title: 'Demo – Bluefin Labs' },
    { day: 3, at: 10.5, minutes: 60, title: 'Advisor session' },
    { day: 4, at: 11.5, minutes: 30, title: 'Contractor sync' },
  ],
  days: [
    { start: 8.3, end: 17.2, lunch: [12.6, 30] },
    { start: 8.3, end: 17.0, lunch: [12.5, 30] },
    { start: 8.2, end: 17.3, lunch: [12.8, 35] },
    { start: 8.3, end: 17.4, lunch: [13.0, 30] },
    { start: 8.4, end: 16.4, lunch: [12.5, 45] },
    { start: 9.8, end: 11.0 },
    { start: 19.2, end: 20.4 },
  ],
  fillers: [
    [
      vscodeWork('lumos-app', ['csv.ts', 'billing.ts', 'schema.prisma', 'page.tsx', 'worker.ts'], [
        (c) => `OPENAI_API_KEY=${c.sim.plant(secrets.openai(c.r))}`,
        (c) => `ANTHROPIC_API_KEY=${c.sim.plant(secrets.anthropic(c.r))}`,
        (c) => `STRIPE_SECRET_KEY=${c.sim.plant(secrets.stripeLive(c.r))}`,
      ]),
      5,
    ],
    [
      terminalWork('lumos-app', [
        (c) => `$ curl -H "Authorization: Bearer ${c.sim.plant(secrets.jwt(c.r))}" localhost:3000/api/me`,
        (c) => `$ aws configure list\naccess_key ${c.sim.plant(secrets.awsKeyId(c.r))}`,
        (c) => `$ git push https://alex:${c.sim.plant(secrets.github(c.r))}@github.com/getlumos/app`,
      ]),
      1.5,
    ],
    [
      (c, budget) =>
        c.sim.dwell(web(c, 'https://dashboard.stripe.com/apikeys', 'API keys – Lumos – Stripe', [axd(['Standard keys'], ['Reveal live key', 'Roll key'], `Secret key ${c.sim.plant(secrets.stripeLive(c.r))}`)]), dur(c, budget, 30, 120), { axEvery: [10, 30], clips: 1 }),
      0.25,
    ],
    [figmaWork(['Lumos – App v2', 'Lumos – Landing page']), 0.7],
    [emailTriage, 2],
    [slackChat(ORG, ['#general', '#eng', '#metrics', '#customers']), 1],
    [(c, budget) => c.sim.dwell(web(c, 'https://x.com/home', 'Home / X', [axd(['Home'], ['Post', 'Reply'], 'For you · Following')]), dur(c, budget, 120, 600), { axEvery: [30, 90] }), 0.6],
    [(c, budget) => c.sim.dwell(nat(NATIVE.notion, 'Investor update – November', [axd(['Investor update'], ['Share'], 'Highlights. Lowlights. Asks. MRR.')]), dur(c, budget, 300, 1500), { axEvery: [30, 90] }), 0.7],
    [linkedinBrowse, 0.8],
    [readNews, 0.8],
    [aiChat, 1],
    [coffeeBreak, 0.8],
    [personalBanking, 0.4],
    [passwordThenLogin('https://dashboard.stripe.com/login', 'Stripe: Sign in'), 0.3],
    [privateBrowsing, 0.25],
  ],
  interrupts: [emailPeek, slackPing(ORG, ['#eng', '#customers']), messagesPing],
  flicker: (c) => [nat(NATIVE.slack, null), gmailInbox(c), nat(NATIVE.iterm, 'zsh — lumos-app')],
  meetingScreen: zoomScreen,
  distractors: [
    'Long VS Code coding sessions; .env with OpenAI/Anthropic/Stripe keys (must be redacted)',
    'Terminal work with JWTs, AWS key ids and GitHub tokens (must be redacted)',
    'Stripe API-keys page (same app as MRR workflow, not a workflow)',
    'LinkedIn feed browsing (same app as the lead workflow, not a workflow)',
    'Zoom demos, investor and advisor calls',
    'Investor update drafting in Notion, Figma, X, Hacker News, AI assistants',
    'Weekend: Saturday support, Sunday evening lead follow-up',
    'Personal banking (Mercury), private windows, 1Password → Stripe login (excluded / secure field)',
  ],
};
