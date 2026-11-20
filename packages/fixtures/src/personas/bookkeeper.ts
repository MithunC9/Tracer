import { axd, BROWSERS, nat, NATIVE, web, type Ctx, type PersonaDef } from '../engine.js';
import { emailFor, iban, money, personName, ssn, stableDocId } from '../fake.js';
import {
  aiChat,
  calendarPeek,
  coffeeBreak,
  dur,
  emailPeek,
  emailTriage,
  gmailCompose,
  gmailInbox,
  gmailThread,
  healthPortal,
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

const CLIENTS = ['Corvid Coffee', 'Maple Street Bakery', 'Brightside Dental', 'Orbit Fitness', 'Lumen Legal', 'Harbor & Pine'];
const VENDORS = ['Sysco', 'WebstaurantStore', 'Henry Schein', 'Comcast Business', 'Uline', 'ADP', 'Staples'];
const qbo = (c: Ctx, path: string, title: string, ax: ReturnType<typeof axd>[]) => web(c, `https://app.qbo.intuit.com/app/${path}`, title, ax);
const sheet = (_c: Ctx, name: string) => `https://docs.google.com/spreadsheets/d/${stableDocId('bookkeeper:' + name)}/edit#gid=0`;

export const bookkeeper: PersonaDef = {
  id: 'bookkeeper',
  description:
    'Priya, independent bookkeeper for six small businesses (New York, UTC-5). Works in Stripe, Google Sheets, QuickBooks Online, Expensify, BILL and Gmail; many client bank-portal visits (excluded by default).',
  tzOffsetHours: -5,
  browser: BROWSERS.chrome,
  me: { name: 'Priya Raman', email: 'priya@ramanbooks.com', domain: 'ramanbooks.com' },
  workflows: [
    {
      id: 'wf_stripe_payouts',
      label: 'Stripe payouts → export CSV → clean in Google Sheets → enter deposits in QuickBooks',
      interruptP: 0.25,
      vars: (c) => ({ client: c.r.pick(CLIENTS.slice(0, 4)), month: 'Nov' }),
      steps: [
        {
          appKey: 'stripe',
          action: 'review',
          label: 'Review payouts in Stripe',
          minutes: [2, 5],
          screens: (c) => [
            web(c, `https://dashboard.stripe.com/payouts?status=paid`, `Payouts – ${c.v.client} – Stripe`, [
              axd(['Payouts'], ['Filter', 'Export', 'Date', 'Status'], `Paid $${money(c.r, 800, 9000)} Nov ${c.r.int(1, 6)} po_1Q${c.r.str(22)}\nPaid $${money(c.r, 800, 9000)} Oct 31`),
            ]),
            web(c, `https://dashboard.stripe.com/payouts/po_1Q${c.r.str(22)}`, `Payout details – ${c.v.client} – Stripe`, [
              axd(['Payout'], ['Transactions', 'Export'], `Gross $${money(c.r, 900, 9500)} Fees $${money(c.r, 20, 300)} Net`),
            ]),
          ],
        },
        {
          appKey: 'stripe',
          action: 'export',
          label: 'Export payout transactions CSV',
          minutes: [1, 2.5],
          screens: (c) => [
            web(c, `https://dashboard.stripe.com/payouts?export=true`, `Export payouts – ${c.v.client} – Stripe`, [
              axd(['Export'], ['Date range', 'Columns', 'Export', 'Cancel'], 'Export 1 file: payouts.csv (UTC timezone)'),
            ]),
          ],
        },
        {
          appKey: 'google_sheets',
          action: 'import',
          label: 'Import CSV into the client payouts sheet',
          minutes: [1.5, 4],
          screens: (c) => [
            web(c, sheet(c, c.v.client!), `${c.v.client} – Stripe payouts ${c.v.month} - Google Sheets`, [
              axd(['Import file'], ['Upload', 'Replace current sheet', 'Append to current sheet', 'Import data'], 'payouts.csv'),
            ]),
          ],
        },
        {
          appKey: 'google_sheets',
          action: 'edit',
          label: 'Clean and categorize payout rows',
          minutes: [4, 12],
          clips: 2,
          screens: (c) => [
            web(c, sheet(c, c.v.client!), `${c.v.client} – Stripe payouts ${c.v.month} - Google Sheets`, [
              axd(['Sheet1', 'Clean'], ['Data', 'Filter', 'Sort range', 'Format'], `=SUMIF(C:C,"payout",E:E)  Gross  Fee  Net  Category`),
              axd(['Clean'], ['Data', 'Filter'], `Remove duplicates. Net total ${money(c.r, 2000, 20000)}`),
            ]),
          ],
        },
        {
          appKey: 'quickbooks',
          action: 'reconcile',
          label: 'Enter deposits in QuickBooks',
          minutes: [4, 11],
          screens: (c) => [
            qbo(c, 'deposit', `Make deposit - ${c.v.client} - QuickBooks Online`, [
              axd(['Deposit'], ['Received from', 'Account', 'Payment method', 'Amount', 'Save and close'], `Stripe payout ${money(c.r, 800, 9000)} Undeposited Funds`),
            ]),
            qbo(c, 'reconcile', `Reconcile - ${c.v.client} - QuickBooks Online`, [
              axd(['Reconcile'], ['Statement ending balance', 'Finish now'], `Difference 0.00`),
            ]),
          ],
        },
      ],
    },
    {
      id: 'wf_expense_receipts',
      label: 'Review Expensify reports → approve → categorize expenses in QuickBooks',
      interruptP: 0.2,
      vars: (c) => ({ client: c.r.pick(CLIENTS), who: personName(c.r) }),
      steps: [
        {
          appKey: 'expensify',
          action: 'review',
          label: 'Review submitted expense reports',
          minutes: [2, 6],
          screens: (c) => [
            web(c, `https://www.expensify.com/reports?param={"reportID":"${c.r.digits(8)}"}`, `${c.v.who} - ${c.v.client} Expenses - Expensify`, [
              axd(['Report'], ['Approve', 'Hold', 'Comment', 'Receipt'], `Uber $${money(c.r, 12, 60)}  Office Depot $${money(c.r, 20, 200)}  Lunch with client $${money(c.r, 30, 140)}`),
            ]),
          ],
        },
        {
          appKey: 'expensify',
          action: 'approve',
          label: 'Approve the report',
          minutes: [0.7, 2],
          screens: (c) => [web(c, `https://www.expensify.com/reports?approve=1`, `Approve report - Expensify`, [axd(['Approve'], ['Approve', 'Cancel'], 'Approve and forward to QuickBooks export')])],
        },
        {
          appKey: 'quickbooks',
          action: 'edit',
          label: 'Categorize synced expenses in QuickBooks',
          minutes: [3, 8],
          screens: (c) => [
            qbo(c, 'expenses', `Expenses - ${c.v.client} - QuickBooks Online`, [
              axd(['Expense Transactions'], ['Category', 'Payee', 'Save'], `Travel  Meals and Entertainment  Office Supplies  ${money(c.r, 50, 600)}`),
            ]),
          ],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Ask client for a missing receipt',
          minutes: [1, 3],
          skipP: 0.45,
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.who!, 'clientco.com')), `Missing receipt – ${c.v.client}`, 'Hi! Could you send the receipt for the Nov 3 charge?')],
        },
      ],
    },
    {
      id: 'wf_bill_pay',
      label: 'Vendor bill in Gmail → open PDF → enter bill in BILL → approve payment',
      interruptP: 0.2,
      vars: (c) => ({ vendor: c.r.pick(VENDORS), client: c.r.pick(CLIENTS), inv: String(c.r.int(10000, 99999)) }),
      steps: [
        {
          appKey: 'gmail',
          action: 'read',
          label: 'Open vendor invoice email',
          minutes: [0.8, 2.5],
          screens: (c) => [gmailThread(c, `Invoice ${c.v.inv} from ${c.v.vendor}`, `${c.v.vendor} Billing <billing@${c.v.vendor!.toLowerCase().replace(/\W/g, '')}.com>`, `Please find attached invoice ${c.v.inv}. Amount due $${money(c.r, 80, 4000)}.`)],
        },
        {
          appKey: 'pdf_viewer',
          action: 'review',
          label: 'Check the PDF invoice',
          minutes: [0.8, 2.5],
          skipP: 0.25,
          screens: (c) => [
            nat(NATIVE.preview, `Invoice_${c.v.inv}.pdf`, [
              axd([`INVOICE ${c.v.inv}`], ['Zoom', 'Markup'], `Bill to ${c.v.client}. Remit to IBAN ${c.sim.plant(iban(c.r, 'GB'))}. Terms Net 30.`),
            ]),
          ],
        },
        {
          appKey: 'bill_com',
          action: 'compose',
          label: 'Enter the bill in BILL',
          minutes: [3, 8],
          clips: 1,
          screens: (c) => [
            web(c, `https://app.bill.com/neo/bills/new`, `New bill - ${c.v.client} - BILL`, [
              axd(['New Bill'], ['Vendor', 'Invoice #', 'Invoice date', 'Due date', 'Amount', 'Save'], `${c.v.vendor} ${c.v.inv}`),
            ]),
          ],
        },
        {
          appKey: 'bill_com',
          action: 'approve',
          label: 'Approve and schedule payment',
          minutes: [0.8, 3],
          screens: (c) => [web(c, `https://app.bill.com/neo/bills/approvals`, `Approvals - ${c.v.client} - BILL`, [axd(['Approvals'], ['Approve', 'Deny', 'Schedule payment'], `${c.v.vendor} due Dec 1`)])],
        },
      ],
    },
    {
      id: 'wf_month_end_pack',
      label: 'Pull P&L from QuickBooks → paste into Excel client pack → email client',
      interruptP: 0.3,
      vars: (c) => ({ client: c.r.pick(CLIENTS), contact: personName(c.r) }),
      steps: [
        {
          appKey: 'quickbooks',
          action: 'export',
          label: 'Run and export the Profit & Loss report',
          minutes: [2, 5],
          clips: 2,
          screens: (c) => [
            qbo(c, 'reportv2?token=PROFIT_AND_LOSS', `Profit and Loss - ${c.v.client} - QuickBooks Online`, [
              axd(['Profit and Loss', 'October 2026'], ['Customize', 'Export to Excel', 'Run report'], `Total Income ${money(c.r, 20000, 90000)} Net Operating Income ${money(c.r, 1000, 20000)}`),
            ]),
          ],
        },
        {
          appKey: 'excel',
          action: 'paste',
          label: 'Paste figures into the client pack',
          minutes: [4, 12],
          screens: (c) => [nat(NATIVE.excel, `${c.v.client} - Monthly pack Oct.xlsx`, [axd(['P&L', 'Summary'], ['Paste', 'Format', 'Insert'], `Revenue  COGS  Gross margin  ${c.r.int(20, 70)}%`)])],
        },
        {
          appKey: 'excel',
          action: 'edit',
          label: 'Update commentary and charts',
          minutes: [3, 9],
          screens: (c) => [nat(NATIVE.excel, `${c.v.client} - Monthly pack Oct.xlsx`, [axd(['Summary'], ['Chart', 'Comments'], 'Revenue up vs September; payroll flat.')])],
        },
        {
          appKey: 'gmail',
          action: 'compose',
          label: 'Email the pack to the client',
          minutes: [1.5, 4],
          clipKind: 'file',
          screens: (c) => [gmailCompose(c, c.sim.plant(emailFor(c.r, c.v.contact!, 'clientco.com')), `October financials – ${c.v.client}`, `Hi ${c.v.contact}, attached is the October pack. Happy to walk through it.`)],
        },
      ],
    },
  ],
  schedule: {
    wf_stripe_payouts: [[0, 9.4], [1, 10.2], [2, 14.3], [3, 9.5], [4, 10.6]],
    wf_expense_receipts: [[0, 14.2], [1, 9.1], [2, 10.4], [3, 13.6], [4, 9.2], [4, 14.7]],
    wf_bill_pay: [[0, 10.5], [0, 15.6], [1, 14.4], [2, 9.2], [3, 11.0], [4, 13.2], [5, 10.3]],
    wf_month_end_pack: [[1, 15.3], [3, 14.5], [4, 15.4]],
  },
  meetings: [
    { day: 0, at: 11.25, minutes: 30, title: 'Corvid Coffee monthly review' },
    { day: 2, at: 12.9, minutes: 45, title: 'Brightside Dental onboarding' },
    { day: 3, at: 16.0, minutes: 25, title: 'Orbit Fitness check-in' },
  ],
  days: [
    { start: 8.5, end: 16.9, lunch: [12.3, 40] },
    { start: 8.4, end: 17.0, lunch: [12.5, 35] },
    { start: 8.7, end: 16.6, lunch: [12.0, 45] },
    { start: 8.5, end: 17.2, lunch: [12.6, 40] },
    { start: 8.6, end: 16.4, lunch: [12.4, 50] },
    { start: 10.0, end: 10.7 },
    null,
  ],
  fillers: [
    [emailTriage, 3],
    [slackChat('Raman Books', ['#corvid-coffee', '#orbit-fitness-books']), 0.8],
    [readNews, 0.7],
    [coffeeBreak, 1.2],
    [personalBanking, 2.2],
    [passwordThenLogin('https://accounts.intuit.com/app/sign-in', 'Sign in to QuickBooks'), 0.5],
    [
      // QuickBooks "Banking" feed: real work, but excluded by the default 'bank' title keyword.
      (c, budget) =>
        c.sim.dwell(qbo(c, 'banking', `Banking - ${c.r.pick(CLIENTS)} - QuickBooks Online`, [axd(['Bank and credit cards'], ['For review', 'Categorized', 'Excluded'], `For review 24 transactions`)]), dur(c, budget, 120, 600), {
          axEvery: [15, 45],
        }),
      1,
    ],
    [(c, budget) => c.sim.dwell(web(c, 'https://www.irs.gov/forms-pubs/about-form-1099-nec', 'About Form 1099-NEC | Internal Revenue Service', [axd(['Form 1099-NEC'], ['Search'], 'Nonemployee compensation')]), dur(c, budget, 90, 400)), 0.5],
    [
      (c, budget) =>
        c.sim.dwell(
          nat(NATIVE.preview, `W-9 ${personName(c.r)}.pdf`, [axd(['Request for Taxpayer Identification Number'], ['Zoom'], `Name ${personName(c.r)}. SSN ${c.sim.plant(ssn(c.r))}. Address 12 Elm St.`)]),
          dur(c, budget, 40, 180),
          { axEvery: [10, 30] },
        ),
      0.6,
    ],
    [
      (c, budget) =>
        c.sim.dwell(
          web(c, sheet(c, 'Client tracker 2026'), 'Client tracker 2026 - Google Sheets', [axd(['Tracker'], ['Filter'], 'Client  Status  Next close  Hours  Fee')]),
          dur(c, budget, 120, 900),
          { axEvery: [20, 60], clips: c.r.int(0, 2) },
        ),
      1.4,
    ],
    [(c, budget) => c.sim.dwell(nat(NATIVE.excel, 'Payroll summary Q4.xlsx', [axd(['Q4'], ['Sum'], 'Gross wages  Taxes  Net')]), dur(c, budget, 300, 1500), { axEvery: [30, 90] }), 0.8],
    [calendarPeek, 0.6],
    [youtube, 0.3],
    [privateBrowsing, 0.25],
    [aiChat, 0.5],
    [healthPortal, 0.1],
  ],
  interrupts: [emailPeek, messagesPing, slackPing('Raman Books', ['#corvid-coffee']), calendarPeek],
  flicker: (c) => [gmailInbox(c), nat(NATIVE.finder, 'Downloads'), nat(NATIVE.slack, '#corvid-coffee (Channel) - Raman Books - Slack')],
  meetingScreen: zoomScreen,
  distractors: [
    'Client bank-portal logins and statement downloads (excluded by default: bank_portal hosts)',
    'QuickBooks "Banking" feed review — excluded by the default "bank" title keyword',
    'Ad-hoc Google Sheets work on the client tracker (same app as workflows, not a workflow)',
    'Payroll summary edits in Excel',
    'Zoom client meetings (Mon, Wed, Thu)',
    'W-9 PDF review in Preview (contains SSN, must be redacted)',
    'Gmail inbox triage, Slack Connect chatter, IRS form lookups, news, YouTube',
    '1Password unlocks (excluded) followed by QuickBooks sign-in with a secure password field',
    'Private-browsing windows and a health-portal visit (excluded)',
    'Lunch and coffee idle gaps',
  ],
};

