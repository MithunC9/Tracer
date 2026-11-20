import { axd, BROWSERS, nat, NATIVE, web, type Ctx, type PersonaDef } from '../engine.js';
import { card, emailFor, money, personName, phoneUS, secrets, stableDocId } from '../fake.js';
import type { Screen } from '../sim.js';
import {
  calendarPeek,
  coffeeBreak,
  dur,
  emailPeek,
  emailTriage,
  gmailCompose,
  gmailInbox,
  gmailThread,
  linkedinBrowse,
  meetScreen,
  messagesPing,
  passwordThenLogin,
  personalBanking,
  privateBrowsing,
  readNews,
  shopping,
  slackChat,
  slackPing,
  slackScreen,
  spotify,
  youtube,
} from './common.js';

const ORG = 'Atlas Outdoor';
const STORE = 'https://admin.shopify.com/store/atlas-outdoor';
const ZD = 'https://atlasoutdoor.zendesk.com/agent';
const sheet = (name: string) => `https://docs.google.com/spreadsheets/d/${stableDocId('ops:' + name)}/edit#gid=${name.length * 7919}`;
const PRODUCTS = ['Trail 35L Pack', 'Ridge Down Jacket', 'Summit Trekking Poles', 'Basecamp Tent 2P', 'Alpine Merino Beanie', 'Canyon Water Filter'];
const SUPPLIERS = ['Kestrel Textiles', 'Northbound Gear Supply', 'Pacific Outfitters Mfg'];

const shopify = (c: Ctx, path: string, title: string, ax: ReturnType<typeof axd>[]): Screen => web(c, `${STORE}/${path}`, `${title} · ${ORG} · Shopify`, ax);

function customerTicketText(c: Ctx, name: string, order: string): string {
  const roll = c.r.next();
  let t = `Hi, my order #${order} hasn't arrived yet. Can you check? Thanks, ${name}`;
  if (roll < 0.35) t += `\nYou can call me at ${c.sim.plant(phoneUS(c.r))}`;
  else if (roll < 0.45) t += `\nI paid with ${c.sim.plant(card(c.r))} if that helps find it`;
  return t;
}

export const ops_manager: PersonaDef = {
  id: 'ops_manager',
  description:
    'Jordan, operations manager at a 15-person DTC outdoor-gear brand (Chicago, UTC-6). Lives in Zendesk, Shopify admin, Google Sheets, Slack and Gmail.',
  tzOffsetHours: -6,
  browser: BROWSERS.chrome,
  me: { name: 'Jordan Ellis', email: 'jordan@atlasoutdoor.co', domain: 'atlasoutdoor.co' },
  workflows: [
    {
      id: 'wf_ticket_order_lookup',
      label: 'Zendesk ticket → look up the order in Shopify → reply with a macro',
      interruptP: 0.18,
      vars: (c) => ({ ticket: String(c.r.int(48000, 49999)), order: String(c.r.int(10200, 11999)), customer: personName(c.r) }),
      steps: [
        {
          appKey: 'zendesk',
          action: 'read',
          label: 'Read the customer ticket',
          minutes: [1.5, 3],
          clips: 1,
          screens: (c) => [
            web(c, `${ZD}/tickets/${c.v.ticket}`, `Ticket #${c.v.ticket}: Where is my order? – Atlas Outdoor – Zendesk`, [
              axd([`#${c.v.ticket} Where is my order?`], ['Requester', 'Assignee', 'Macros', 'Submit as Open'], `${c.v.customer} <${c.sim.plant(emailFor(c.r, c.v.customer!, 'gmail.com'))}>\n${customerTicketText(c, c.v.customer!, c.v.order!)}`),
            ]),
          ],
        },
        {
          appKey: 'shopify',
          action: 'search',
          label: 'Search the order in Shopify',
          minutes: [0.8, 2],
          screens: (c) => [shopify(c, `orders?query=${c.v.order}`, 'Orders', [axd(['Orders'], ['Search and filter', 'Export', 'Create order'], `#${c.v.order} ${c.v.customer} Fulfilled $${money(c.r, 40, 420)}`)])],
        },
        {
          appKey: 'shopify',
          action: 'review',
          label: 'Check fulfilment and tracking',
          minutes: [1.5, 4],
          clips: 1,
          screens: (c) => [
            shopify(c, `orders/${c.r.digits(13)}`, `Order #${c.v.order}`, [
              axd([`#${c.v.order}`, 'Fulfilled'], ['Refund', 'Return', 'More actions', 'Tracking number'], `${c.r.pick(PRODUCTS)} x1. UPS tracking 1Z${c.r.str(16, '0123456789ABCDEFGHJKLMNPRSTUVWXYZ')}. Ship to ${c.v.customer}, ${c.r.int(10, 999)} Lake St`),
            ]),
          ],
        },
        {
          appKey: 'zendesk',
          action: 'compose',
          label: 'Reply with the shipping-status macro',
          minutes: [2, 4],
          screens: (c) => [
            web(c, `${ZD}/tickets/${c.v.ticket}`, `Ticket #${c.v.ticket}: Where is my order? – Atlas Outdoor – Zendesk`, [
              axd([`#${c.v.ticket}`], ['Apply macro', 'Public reply', 'Submit as Solved'], `Macro: Shipping status. Hi ${c.v.customer!.split(' ')[0]}, your order #${c.v.order} is on its way…`),
            ]),
          ],
        },
      ],
    },
    {
      id: 'wf_inventory_reorder',
      label: 'Export inventory from Shopify → update reorder sheet → email supplier PO',
      interruptP: 0.3,
      vars: (c) => ({ supplier: c.r.pick(SUPPLIERS), contact: personName(c.r) }),
      steps: [
        {
          appKey: 'shopify',
          action: 'export',
          label: 'Export inventory CSV',
          minutes: [2, 4],
          screens: (c) => [shopify(c, 'products/inventory?location_id=7182', 'Inventory', [axd(['Inventory'], ['Export', 'Import', 'Location'], `${c.r.pick(PRODUCTS)} available ${c.r.int(0, 40)}`)])],
        },
        {
          appKey: 'google_sheets',
          action: 'import',
          label: 'Import into the reorder sheet',
          minutes: [1.5, 3],
          screens: () => [],
        },
        {
          appKey: 'google_sheets',
          action: 'edit',
          label: 'Compute reorder quantities',
          minutes: [5, 12],
          clips: 2,
          screens: () => [],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Email PO to supplier',
          minutes: [2, 5],
          clipKind: 'file',
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.contact!, 'supplier-mail.com')), `PO ${c.r.int(3000, 3999)} – ${ORG} reorder`, `Hi ${c.v.contact}, please find our reorder attached. Ship to our Chicago 3PL.`)],
        },
      ],
    },
    {
      id: 'wf_returns',
      label: 'Return request email → refund in Shopify → log in returns sheet',
      interruptP: 0.2,
      swap: [1, 0.2],
      vars: (c) => ({ order: String(c.r.int(10200, 11999)), customer: personName(c.r) }),
      steps: [
        {
          appKey: 'gmail',
          action: 'read',
          label: 'Read the return request',
          minutes: [1, 3],
          clips: 1,
          screens: (c) => [gmailThread(c, `Return request – order #${c.v.order}`, `${c.v.customer} <${c.sim.plant(emailFor(c.r, c.v.customer!, 'yahoo.com'))}>`, `The ${c.r.pick(PRODUCTS)} doesn't fit. I'd like a refund please.`)],
        },
        {
          appKey: 'shopify',
          action: 'approve',
          label: 'Issue refund in Shopify',
          minutes: [2, 5],
          screens: (c) => [shopify(c, `orders/${c.r.digits(13)}/refund`, `Refund #${c.v.order}`, [axd(['Refund'], ['Restock item', 'Refund amount', 'Refund'], `Refund $${money(c.r, 40, 300)} to original payment method`)])],
        },
        {
          appKey: 'google_sheets',
          action: 'edit',
          label: 'Log the return',
          minutes: [2, 4],
          screens: (c) => [web(c, sheet('Returns log 2026'), 'Returns log 2026 - Google Sheets', [axd(['Returns'], ['Insert row'], `#${c.v.order}  ${c.v.customer}  reason: size  refunded`)])],
        },
      ],
    },
    {
      id: 'wf_daily_ops_report',
      label: 'Shopify analytics → daily ops sheet → post summary in Slack',
      interruptP: 0.15,
      steps: [
        {
          appKey: 'shopify',
          action: 'review',
          label: 'Read yesterday’s sales & fulfilment numbers',
          minutes: [3, 7],
          clips: 2,
          screens: (c) => [
            shopify(c, 'analytics', 'Analytics', [axd(['Analytics', 'Yesterday'], ['Date range', 'Compare'], `Total sales $${money(c.r, 3000, 15000)} Orders ${c.r.int(40, 160)} Conversion ${c.r.int(18, 35) / 10}%`)]),
            shopify(c, 'orders?fulfillment_status=unshipped', 'Orders', [axd(['Unfulfilled'], ['Fulfill orders'], `${c.r.int(3, 30)} unfulfilled`)]),
          ],
        },
        {
          appKey: 'google_sheets',
          action: 'paste',
          label: 'Paste into the daily ops sheet',
          minutes: [3, 7],
          screens: (c) => [web(c, sheet('Daily ops dashboard'), 'Daily ops dashboard - Google Sheets', [axd(['Daily'], ['Paste special', 'Values only'], `Sales  Orders  AOV  Unfulfilled  Tickets open ${c.r.int(5, 40)}`)])],
        },
        {
          appKey: 'slack',
          action: 'compose',
          label: 'Post the summary in #ops',
          minutes: [1.5, 3.5],
          screens: (c) => [slackScreen(c, ORG, '#ops', `Jordan Ellis: Morning! Yesterday: ${c.r.int(40, 160)} orders, ${c.r.int(3, 30)} to ship, tickets trending down.`)],
        },
      ],
    },
  ],
  schedule: {
    wf_ticket_order_lookup: [[0, 10.2], [0, 13.6], [0, 15.8], [1, 9.8], [1, 14.1], [2, 10.6], [2, 13.2], [2, 15.5], [3, 9.9], [3, 15.1], [4, 10.4], [4, 13.4], [4, 15.0], [5, 11.0]],
    wf_inventory_reorder: [[0, 14.3], [2, 11.2], [3, 13.6], [4, 11.4]],
    wf_returns: [[0, 11.2], [1, 11.1], [1, 15.2], [2, 14.4], [3, 11.0], [3, 14.6], [4, 14.2]],
    wf_daily_ops_report: [[0, 8.9], [1, 9.0], [2, 9.0], [3, 9.1], [4, 9.0]],
  },
  meetings: [
    { day: 0, at: 9.5, minutes: 15, title: 'Ops standup' },
    { day: 1, at: 9.5, minutes: 15, title: 'Ops standup' },
    { day: 1, at: 13.0, minutes: 50, title: '3PL quarterly review' },
    { day: 2, at: 9.5, minutes: 15, title: 'Ops standup' },
    { day: 3, at: 9.5, minutes: 15, title: 'Ops standup' },
    { day: 3, at: 16.0, minutes: 30, title: '1:1 with Head of Ecommerce' },
    { day: 4, at: 9.5, minutes: 15, title: 'Ops standup' },
  ],
  days: [
    { start: 8.3, end: 17.1, lunch: [12.2, 35] },
    { start: 8.4, end: 17.0, lunch: [12.0, 40] },
    { start: 8.3, end: 17.3, lunch: [12.4, 30] },
    { start: 8.5, end: 17.2, lunch: [12.1, 40] },
    { start: 8.4, end: 16.3, lunch: [12.3, 45] },
    { start: 10.8, end: 11.5 },
    null,
  ],
  fillers: [
    [emailTriage, 2],
    [slackChat(ORG, ['#ops', '#cx-team', '#warehouse', '#general', '#random']), 2.5],
    [
      (c, budget) =>
        c.sim.dwell(web(c, `https://app.asana.com/0/${c.r.digits(16)}/list`, 'Q4 Ops Projects - Asana', [axd(['Q4 Ops Projects'], ['Add task', 'Assignee', 'Due date'], 'Holiday shipping cutoffs. Peak staffing plan. Returns portal.')]), dur(c, budget, 180, 1200), {
          axEvery: [20, 70],
        }),
      1.5,
    ],
    [
      (c, budget) =>
        c.sim.dwell(web(c, sheet('Holiday promo plan'), 'Holiday promo plan - Google Sheets', [axd(['Plan'], ['Filter'], 'BFCM discount tiers, inventory risk, ad spend')]), dur(c, budget, 300, 1500), {
          axEvery: [25, 80],
          clips: c.r.int(0, 2),
        }),
      1.2,
    ],
    [
      (c, budget) =>
        c.sim.dwell(web(c, 'https://ship.shipstation.com/orders/awaiting-shipment', 'Awaiting Shipment | ShipStation', [axd(['Awaiting Shipment'], ['Create label', 'Batch'], `${c.r.int(5, 60)} orders`)]), dur(c, budget, 120, 600)),
      0.8,
    ],
    [
      (c, budget) =>
        c.sim.dwell(
          nat(NATIVE.notion, 'Integrations & API keys', [
            axd(['Integrations'], ['Share', 'Comments'], `Shopify admin token: ${c.sim.plant('shp' + 'at_' + c.r.str(32, '0123456789abcdef'))}\nSlack bot: ${c.sim.plant(secrets.slackBot(c.r))}`),
          ]),
          dur(c, budget, 60, 240),
          { axEvery: [15, 40], clips: 1 },
        ),
      0.25,
    ],
    [
      // Zendesk triage without order lookups (views, not the workflow)
      (c, budget) => c.sim.dwell(web(c, `${ZD}/filters/360001`, 'Unsolved tickets – Atlas Outdoor – Zendesk', [axd(['Views'], ['Unsolved tickets', 'Recently updated'], `${c.r.int(4, 40)} tickets`)]), dur(c, budget, 60, 300)),
      1,
    ],
    [readNews, 0.6],
    [coffeeBreak, 1.2],
    [personalBanking, 0.4],
    [passwordThenLogin('https://accounts.shopify.com/lookup', 'Log in — Shopify'), 0.4],
    [privateBrowsing, 0.3],
    [linkedinBrowse, 0.5],
    [shopping, 0.3],
    [youtube, 0.3],
    [calendarPeek, 0.6],
  ],
  interrupts: [emailPeek, slackPing(ORG, ['#ops', '#cx-team', '#warehouse']), slackPing(ORG, ['#ops']), messagesPing, spotify],
  flicker: (c) => [nat(NATIVE.slack, '#ops (Channel) - Atlas Outdoor - Slack'), gmailInbox(c), web(c, `${ZD}/filters/360001`, 'Unsolved tickets – Atlas Outdoor – Zendesk')],
  meetingScreen: meetScreen,
  distractors: [
    'Zendesk view browsing without order lookups (same app as the main workflow)',
    'Asana Q4 projects and Holiday promo planning in Google Sheets',
    'ShipStation label checks',
    'Daily Google Meet standup, 3PL review, 1:1',
    'Heavy Slack chatter across #ops/#cx-team/#warehouse',
    'Notion page with integration tokens (must be redacted)',
    'Shopify login via 1Password (secure field), personal banking, private windows (excluded)',
    'LinkedIn, Amazon shopping, news, YouTube, coffee and lunch idle gaps',
  ],
};

// screens for the import/edit steps share the same sheet; defined here to keep the workflow table readable
const reorder = ops_manager.workflows[1]!;
reorder.steps[1]!.screens = (c) => [
  web(c, sheet('Reorder planner'), 'Reorder planner - Google Sheets', [axd(['Import file'], ['Upload', 'Replace data at selected cell', 'Import data'], 'inventory_export.csv')]),
];
reorder.steps[2]!.screens = (c) => [
  web(c, sheet('Reorder planner'), 'Reorder planner - Google Sheets', [
    axd(['Reorder'], ['Data', 'Filter views'], `=MAX(0, C2*14 - D2)  ${c.r.pick(PRODUCTS)} reorder ${c.r.int(20, 200)}`),
    axd(['Reorder'], ['Data'], `Supplier ${c.v.supplier}  lead time ${c.r.int(10, 30)} days`),
  ]),
];
