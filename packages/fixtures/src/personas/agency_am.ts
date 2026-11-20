import { axd, BROWSERS, nat, NATIVE, web, type PersonaDef } from '../engine.js';
import { card, emailFor, iban, money, personName, phoneIntl, secrets, stableDocId } from '../fake.js';
import {
  aiChat,
  calendarPeek,
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
  youtube,
  zoomScreen,
} from './common.js';

const ORG = 'Brightloop';
const CLIENTS = ['Harbor & Pine', 'Orbit Fitness', 'Sundial Health', 'Lumen Legal', 'Corvid Coffee'];
const doc = (name: string) => `https://docs.google.com/document/d/${stableDocId('am:' + name)}/edit`;
const sheet = (name: string) => `https://docs.google.com/spreadsheets/d/${stableDocId('am:' + name)}/edit#gid=0`;
const slug = (s: string) => s.toLowerCase().replace(/\W+/g, '');

export const agency_am: PersonaDef = {
  id: 'agency_am',
  description:
    'Sam, account manager at a 20-person marketing agency handling five retainer clients (London, UTC+0). HubSpot reporting, Canva content approvals, Notion call notes, Mailchimp tracking.',
  tzOffsetHours: 0,
  browser: BROWSERS.chrome,
  me: { name: 'Sam Whitfield', email: 'sam.whitfield@brightloop.agency', domain: 'brightloop.agency' },
  workflows: [
    {
      id: 'wf_weekly_client_report',
      label: 'Pull weekly metrics from HubSpot → paste into Google Docs report → email client',
      interruptP: 0.3,
      vars: (c) => ({ client: c.r.pick(CLIENTS), contact: personName(c.r) }),
      steps: [
        {
          appKey: 'hubspot',
          action: 'review',
          label: 'Open the client dashboard in HubSpot',
          minutes: [3, 7],
          clips: 3,
          screens: (c) => [
            web(c, `https://app.hubspot.com/reports-dashboard/${c.r.digits(7)}/view/${c.r.digits(6)}`, `${c.v.client} weekly | Dashboards | HubSpot`, [
              axd(['Weekly performance'], ['Date range', 'Filter', 'Export', 'Share'], `Sessions ${c.r.int(2000, 40000)} Leads ${c.r.int(20, 400)} MQLs ${c.r.int(5, 80)} Email open rate ${c.r.int(18, 45)}%`),
            ]),
          ],
        },
        {
          appKey: 'google_docs',
          action: 'paste',
          label: 'Paste the numbers into the weekly report',
          minutes: [4, 10],
          screens: (c) => [web(c, doc(`${c.v.client} weekly report`), `${c.v.client} – Weekly report – Google Docs`, [axd(['Weekly report', 'KPIs'], ['Paste', 'Insert table'], 'Sessions | Leads | MQLs | Δ vs last week')])],
        },
        {
          appKey: 'google_docs',
          action: 'edit',
          label: 'Write commentary and next steps',
          minutes: [3, 8],
          screens: (c) => [web(c, doc(`${c.v.client} weekly report`), `${c.v.client} – Weekly report – Google Docs`, [axd(['Commentary'], ['Suggesting', 'Comment'], 'Paid social CPL down; organic flat; recommend new lead magnet.')])],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Email the report to the client',
          minutes: [2, 4],
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.contact!, slug(c.v.client!) + '.co.uk')), `${c.v.client} – weekly report`, `Hi ${c.v.contact}, this week's report is linked below. Speak Thursday!`)],
        },
      ],
    },
    {
      id: 'wf_content_approval',
      label: 'Finish social posts in Canva → send for client approval → update Asana',
      interruptP: 0.25,
      vars: (c) => ({ client: c.r.pick(CLIENTS), contact: personName(c.r) }),
      steps: [
        {
          appKey: 'canva',
          action: 'edit',
          label: 'Finalize social posts in Canva',
          minutes: [4, 12],
          screens: (c) => [web(c, `https://www.canva.com/design/DAG${c.r.str(8)}/edit`, `${c.v.client} – November social – Instagram Post`, [axd(['November social'], ['Share', 'Download', 'Resize'], `${c.r.int(4, 9)} pages`)])],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Send the designs for approval',
          minutes: [2, 5],
          clips: 1,
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.contact!, slug(c.v.client!) + '.com')), `For approval: November social – ${c.v.client}`, 'Hi! Here are next week’s posts. Approve by Friday please.')],
        },
        {
          appKey: 'asana',
          action: 'edit',
          label: 'Move the task to "Awaiting approval"',
          minutes: [1, 3],
          screens: (c) => [web(c, `https://app.asana.com/0/${c.r.digits(16)}/board`, `${c.v.client} content calendar - Asana`, [axd(['Board'], ['Awaiting approval', 'Scheduled', 'Done'], 'November social → Awaiting approval')])],
        },
      ],
    },
    {
      id: 'wf_call_recap',
      label: 'After client call: notes in Notion → tasks in Asana → recap email',
      interruptP: 0.2,
      vars: (c) => ({ client: c.r.pick(CLIENTS), contact: personName(c.r) }),
      steps: [
        {
          appKey: 'notion',
          action: 'compose',
          label: 'Write up call notes in Notion',
          minutes: [4, 10],
          screens: (c) => [nat(NATIVE.notion, `${c.v.client} – call notes`, [axd(['Call notes', 'Action items'], ['Share', 'Add a comment'], `Attendees: ${c.v.contact}. Budget for Q1 approved. Contact ${c.sim.plant(phoneIntl(c.r, 'GB'))}`)])],
        },
        {
          appKey: 'asana',
          action: 'compose',
          label: 'Create follow-up tasks',
          minutes: [2, 5],
          screens: (c) => [web(c, `https://app.asana.com/0/${c.r.digits(16)}/list`, `${c.v.client} account - Asana`, [axd(['List'], ['Add task', 'Assignee', 'Due date'], 'Send revised media plan; book shoot; update brief')])],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Send recap email',
          minutes: [2, 5],
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.contact!, slug(c.v.client!) + '.com')), `Recap: today's call`, 'Thanks for the time today. Actions below…')],
        },
      ],
    },
    {
      id: 'wf_campaign_tracker',
      label: 'Check Mailchimp campaign stats → update Google Sheets tracker',
      interruptP: 0.15,
      vars: (c) => ({ client: c.r.pick(CLIENTS) }),
      steps: [
        {
          appKey: 'mailchimp',
          action: 'review',
          label: 'Review campaign report',
          minutes: [2, 5],
          clips: 2,
          screens: (c) => [web(c, `https://us14.admin.mailchimp.com/reports/summary?id=${c.r.digits(7)}`, `Reports | Mailchimp`, [axd([`${c.v.client} newsletter`], ['Overview', 'Activity', 'Links'], `Opens ${c.r.int(20, 50)}% Clicks ${c.r.int(1, 9)}% Unsubscribes ${c.r.int(0, 20)}`)])],
        },
        {
          appKey: 'google_sheets',
          action: 'edit',
          label: 'Update the campaign tracker',
          minutes: [3, 7],
          screens: (c) => [web(c, sheet('Campaign tracker'), 'Campaign tracker Q4 - Google Sheets', [axd(['Tracker'], ['Paste', 'Filter'], `${c.v.client}  open  click  revenue £${money(c.r, 200, 6000)}`)])],
        },
      ],
    },
  ],
  schedule: {
    wf_weekly_client_report: [[0, 9.4], [0, 11.0], [0, 15.0], [1, 9.6], [1, 11.4]],
    wf_content_approval: [[0, 16.2], [1, 15.0], [2, 10.0], [2, 15.6], [3, 11.8], [4, 10.6]],
    wf_call_recap: [[0, 14.0], [1, 13.7], [2, 12.0], [2, 17.0], [3, 15.1], [4, 12.3]],
    wf_campaign_tracker: [[0, 13.2], [1, 10.6], [1, 16.6], [2, 9.3], [3, 9.3], [3, 13.2], [4, 9.4], [4, 14.4]],
  },
  meetings: [
    { day: 0, at: 13.4, minutes: 30, title: 'Harbor & Pine weekly' },
    { day: 1, at: 13.0, minutes: 35, title: 'Orbit Fitness status call' },
    { day: 2, at: 11.25, minutes: 40, title: 'Sundial Health quarterly planning' },
    { day: 2, at: 16.3, minutes: 30, title: 'Lumen Legal check-in' },
    { day: 3, at: 10.0, minutes: 60, title: 'Agency all-hands' },
    { day: 3, at: 14.5, minutes: 30, title: 'Corvid Coffee campaign review' },
    { day: 4, at: 11.6, minutes: 35, title: 'Harbor & Pine creative review' },
  ],
  days: [
    { start: 9.0, end: 17.9, lunch: [12.6, 40] },
    { start: 8.9, end: 18.0, lunch: [12.4, 30] },
    { start: 9.1, end: 18.1, lunch: [13.0, 35] },
    { start: 9.0, end: 17.6, lunch: [12.6, 45] },
    { start: 9.2, end: 16.8, lunch: [13.0, 60] },
    null,
    { start: 18.5, end: 19.0 },
  ],
  fillers: [
    [emailTriage, 3],
    [slackChat(ORG, ['#accounts', '#creative', '#paid-social', '#general', '#harbor-pine']), 3],
    [
      (c, budget) =>
        c.sim.dwell(web(c, `https://docs.google.com/presentation/d/${stableDocId('am:pitch')}/edit#slide=id.p${c.r.int(1, 30)}`, 'Q1 strategy pitch – Google Slides', [axd(['Q1 strategy'], ['Present', 'Insert'], 'Audience insights. Channel mix. Budget.')]), dur(c, budget, 300, 1500), {
          axEvery: [30, 90],
          clips: c.r.int(0, 2),
        }),
      1.3,
    ],
    [(c, budget) => c.sim.dwell(web(c, 'https://analytics.google.com/analytics/web/#/p3141/reports', 'Reports snapshot – Analytics', [axd(['Reports snapshot'], ['Date range'], 'Users 12,402  Sessions 18,551')]), dur(c, budget, 120, 600)), 0.7],
    [(c, budget) => c.sim.dwell(web(c, `https://www.canva.com/design/DAG${c.r.str(8)}/edit`, 'Brightloop – Moodboard ideas', [axd(['Moodboard'], ['Elements'], 'Draft')]), dur(c, budget, 300, 1200), { axEvery: [30, 90] }), 0.8],
    [
      (c, budget) =>
        c.sim.dwell(
          nat(NATIVE.notion, 'Agency tool setup', [
            axd(['Integrations'], ['Share'], `Slack webhook bot ${c.sim.plant(secrets.slackBot(c.r))}\nHubSpot api_key: ${c.sim.plant(c.r.str(8, 'abcdef0123456789') + '-' + c.r.str(4, 'abcdef0123456789') + '-' + c.r.str(4, 'abcdef0123456789'), true)}`),
          ]),
          dur(c, budget, 60, 240),
          { axEvery: [15, 40] },
        ),
      0.2,
    ],
    [
      (c, budget) =>
        c.sim.dwell(
          web(c, `https://app.hubspot.com/contacts/${c.r.digits(7)}/record/0-1/${c.r.digits(9)}`, `${personName(c.r)} | Contact | HubSpot`, [axd(['About this contact'], ['Email', 'Call', 'Log activity'], `Phone ${c.sim.plant(phoneIntl(c.r, 'GB'))} Email ${c.sim.plant(emailFor(c.r, personName(c.r), 'client.co.uk'))}`)]),
          dur(c, budget, 60, 300),
          { axEvery: [15, 45] },
        ),
      0.9,
    ],
    [
      (c, budget) =>
        c.sim.dwell(
          web(c, 'https://business.facebook.com/billing_hub/payment_settings', 'Billing & payments | Meta Business Suite', [axd(['Payment methods'], ['Add payment method'], `Card ${c.sim.plant(card(c.r))} · Agency IBAN ${c.sim.plant(iban(c.r, 'GB'))}`)]),
          dur(c, budget, 60, 240),
          { axEvery: [15, 40] },
        ),
      0.3,
    ],
    [linkedinBrowse, 0.6],
    [calendarPeek, 0.8],
    [readNews, 0.5],
    [aiChat, 0.6],
    [coffeeBreak, 1],
    [youtube, 0.2],
    [personalBanking, 0.3],
    [passwordThenLogin('https://app.hubspot.com/login', 'HubSpot Login'), 0.4],
    [privateBrowsing, 0.25],
  ],
  interrupts: [emailPeek, slackPing(ORG, ['#accounts', '#creative']), slackPing(ORG, ['#harbor-pine']), messagesPing, calendarPeek],
  flicker: (c) => [nat(NATIVE.slack, null), gmailInbox(c), web(c, 'https://calendar.google.com/calendar/u/0/r/week', 'Google Calendar - Week')],
  meetingScreen: zoomScreen,
  distractors: [
    'Google Slides strategy pitch (resolves to other:docs.google.com — Slides is not in the app taxonomy)',
    'Zoom client calls (the recap workflow follows some of them; the call itself is not part of the workflow)',
    'HubSpot contact lookups (same app as reporting, not a workflow)',
    'Canva moodboards, Google Analytics glances, LinkedIn',
    'Heavy Slack and Gmail triage',
    'Meta billing page with a card and IBAN, Notion page with tokens (must be redacted)',
    'Agency all-hands, private windows, personal banking, HubSpot login via 1Password',
  ],
};
