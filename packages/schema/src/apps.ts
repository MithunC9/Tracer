import { z } from 'zod';

/**
 * Canonical app taxonomy. The agent maps raw bundle ids / window hosts to an AppKey
 * on-device; the pipeline, catalog and fixtures all speak AppKey. Unknown apps are
 * reported as `other:<slug>`.
 */
export const AppCategory = z.enum([
  'email',
  'spreadsheet',
  'docs',
  'crm',
  'accounting',
  'banking',
  'payments',
  'calendar',
  'meetings',
  'chat',
  'project_management',
  'browser',
  'design',
  'coding',
  'terminal',
  'files',
  'ecommerce',
  'marketing',
  'support',
  'notes',
  'password_manager',
  'health',
  'ai_assistant',
  'other',
]);
export type AppCategory = z.infer<typeof AppCategory>;

/** How reachable an app is for automation. Drives `integration_feasibility`. */
export const AutomationSurface = z.object({
  /** Public REST/GraphQL API */
  api: z.boolean(),
  /** Supported by mainstream no-code connectors (Zapier/Make/n8n) */
  noCode: z.boolean(),
  /** Scriptable on desktop (AppleScript/Shortcuts/COM/CLI) */
  desktopScript: z.boolean(),
  /** Has built-in rules/automation of its own */
  nativeRules: z.boolean(),
  /** Supports file import/export (CSV etc.) */
  fileIo: z.boolean(),
});
export type AutomationSurface = z.infer<typeof AutomationSurface>;

export const RiskTag = z.enum(['money', 'pii', 'irreversible', 'credentials', 'health']);
export type RiskTag = z.infer<typeof RiskTag>;

export interface AppDef {
  key: string;
  name: string;
  category: AppCategory;
  bundleIds: string[];
  hosts: string[];
  automation: AutomationSurface;
  risk: RiskTag[];
  /** Excluded from capture by default (password managers, banking, health). */
  excludedByDefault: boolean;
}

const A = (s: Partial<AutomationSurface>): AutomationSurface => ({
  api: false,
  noCode: false,
  desktopScript: false,
  nativeRules: false,
  fileIo: false,
  ...s,
});

const full = A({ api: true, noCode: true, fileIo: true });

export const APPS: readonly AppDef[] = [
  // email / calendar / meetings
  { key: 'gmail', name: 'Gmail', category: 'email', bundleIds: [], hosts: ['mail.google.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'outlook', name: 'Outlook', category: 'email', bundleIds: ['com.microsoft.Outlook'], hosts: ['outlook.office.com', 'outlook.live.com'], automation: { ...full, nativeRules: true, desktopScript: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'apple_mail', name: 'Mail', category: 'email', bundleIds: ['com.apple.mail'], hosts: [], automation: A({ desktopScript: true, nativeRules: true }), risk: ['pii'], excludedByDefault: false },
  { key: 'google_calendar', name: 'Google Calendar', category: 'calendar', bundleIds: [], hosts: ['calendar.google.com'], automation: full, risk: [], excludedByDefault: false },
  { key: 'apple_calendar', name: 'Calendar', category: 'calendar', bundleIds: ['com.apple.iCal'], hosts: [], automation: A({ desktopScript: true }), risk: [], excludedByDefault: false },
  { key: 'calendly', name: 'Calendly', category: 'calendar', bundleIds: [], hosts: ['calendly.com'], automation: full, risk: [], excludedByDefault: false },
  { key: 'zoom', name: 'Zoom', category: 'meetings', bundleIds: ['us.zoom.xos'], hosts: ['zoom.us'], automation: A({ api: true, noCode: true }), risk: [], excludedByDefault: false },
  { key: 'google_meet', name: 'Google Meet', category: 'meetings', bundleIds: [], hosts: ['meet.google.com'], automation: A({ api: true, noCode: true }), risk: [], excludedByDefault: false },
  // chat / pm
  { key: 'slack', name: 'Slack', category: 'chat', bundleIds: ['com.tinyspeck.slackmacgap'], hosts: ['app.slack.com'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'teams', name: 'Microsoft Teams', category: 'chat', bundleIds: ['com.microsoft.teams2'], hosts: ['teams.microsoft.com'], automation: A({ api: true, noCode: true }), risk: [], excludedByDefault: false },
  { key: 'asana', name: 'Asana', category: 'project_management', bundleIds: [], hosts: ['app.asana.com'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'linear', name: 'Linear', category: 'project_management', bundleIds: ['com.linear'], hosts: ['linear.app'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'trello', name: 'Trello', category: 'project_management', bundleIds: [], hosts: ['trello.com'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'notion', name: 'Notion', category: 'docs', bundleIds: ['notion.id'], hosts: ['www.notion.so', 'notion.so'], automation: full, risk: [], excludedByDefault: false },
  { key: 'jira', name: 'Jira', category: 'project_management', bundleIds: [], hosts: ['atlassian.net'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  // docs / spreadsheets / files
  { key: 'google_sheets', name: 'Google Sheets', category: 'spreadsheet', bundleIds: [], hosts: ['docs.google.com/spreadsheets'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'google_docs', name: 'Google Docs', category: 'docs', bundleIds: [], hosts: ['docs.google.com/document'], automation: full, risk: [], excludedByDefault: false },
  { key: 'excel', name: 'Excel', category: 'spreadsheet', bundleIds: ['com.microsoft.Excel'], hosts: [], automation: A({ api: true, noCode: true, desktopScript: true, fileIo: true }), risk: [], excludedByDefault: false },
  { key: 'word', name: 'Word', category: 'docs', bundleIds: ['com.microsoft.Word'], hosts: [], automation: A({ desktopScript: true, fileIo: true }), risk: [], excludedByDefault: false },
  { key: 'numbers', name: 'Numbers', category: 'spreadsheet', bundleIds: ['com.apple.iWork.Numbers'], hosts: [], automation: A({ desktopScript: true, fileIo: true }), risk: [], excludedByDefault: false },
  { key: 'finder', name: 'Finder', category: 'files', bundleIds: ['com.apple.finder'], hosts: [], automation: A({ desktopScript: true, fileIo: true }), risk: [], excludedByDefault: false },
  { key: 'google_drive', name: 'Google Drive', category: 'files', bundleIds: [], hosts: ['drive.google.com'], automation: full, risk: [], excludedByDefault: false },
  { key: 'dropbox', name: 'Dropbox', category: 'files', bundleIds: ['com.getdropbox.dropbox'], hosts: ['www.dropbox.com'], automation: full, risk: [], excludedByDefault: false },
  { key: 'pdf_viewer', name: 'Preview', category: 'files', bundleIds: ['com.apple.Preview'], hosts: [], automation: A({ desktopScript: true }), risk: [], excludedByDefault: false },
  // crm / sales / support / marketing
  { key: 'hubspot', name: 'HubSpot', category: 'crm', bundleIds: [], hosts: ['app.hubspot.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'salesforce', name: 'Salesforce', category: 'crm', bundleIds: [], hosts: ['lightning.force.com', 'my.salesforce.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'pipedrive', name: 'Pipedrive', category: 'crm', bundleIds: [], hosts: ['app.pipedrive.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'zendesk', name: 'Zendesk', category: 'support', bundleIds: [], hosts: ['zendesk.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'intercom', name: 'Intercom', category: 'support', bundleIds: [], hosts: ['app.intercom.com'], automation: { ...full, nativeRules: true }, risk: ['pii'], excludedByDefault: false },
  { key: 'mailchimp', name: 'Mailchimp', category: 'marketing', bundleIds: [], hosts: ['mailchimp.com'], automation: full, risk: ['pii'], excludedByDefault: false },
  { key: 'linkedin', name: 'LinkedIn', category: 'marketing', bundleIds: [], hosts: ['www.linkedin.com'], automation: A({}), risk: ['pii'], excludedByDefault: false },
  { key: 'shopify', name: 'Shopify', category: 'ecommerce', bundleIds: [], hosts: ['admin.shopify.com'], automation: { ...full, nativeRules: true }, risk: ['money', 'pii'], excludedByDefault: false },
  // finance
  { key: 'quickbooks', name: 'QuickBooks Online', category: 'accounting', bundleIds: [], hosts: ['qbo.intuit.com', 'app.qbo.intuit.com'], automation: { ...full, nativeRules: true }, risk: ['money'], excludedByDefault: false },
  { key: 'xero', name: 'Xero', category: 'accounting', bundleIds: [], hosts: ['go.xero.com'], automation: { ...full, nativeRules: true }, risk: ['money'], excludedByDefault: false },
  { key: 'stripe', name: 'Stripe Dashboard', category: 'payments', bundleIds: [], hosts: ['dashboard.stripe.com'], automation: full, risk: ['money', 'pii'], excludedByDefault: false },
  { key: 'bill_com', name: 'BILL', category: 'payments', bundleIds: [], hosts: ['app.bill.com'], automation: A({ api: true, noCode: true }), risk: ['money', 'irreversible'], excludedByDefault: false },
  { key: 'expensify', name: 'Expensify', category: 'accounting', bundleIds: [], hosts: ['www.expensify.com'], automation: full, risk: ['money'], excludedByDefault: false },
  { key: 'bank_portal', name: 'Bank website', category: 'banking', bundleIds: [], hosts: ['chase.com', 'bankofamerica.com', 'wellsfargo.com', 'mercury.com'], automation: A({ fileIo: true }), risk: ['money', 'irreversible', 'credentials'], excludedByDefault: true },
  // design / coding
  { key: 'figma', name: 'Figma', category: 'design', bundleIds: ['com.figma.Desktop'], hosts: ['www.figma.com'], automation: A({ api: true, noCode: true }), risk: [], excludedByDefault: false },
  { key: 'canva', name: 'Canva', category: 'design', bundleIds: [], hosts: ['www.canva.com'], automation: A({ api: true }), risk: [], excludedByDefault: false },
  { key: 'vscode', name: 'VS Code', category: 'coding', bundleIds: ['com.microsoft.VSCode'], hosts: [], automation: A({ desktopScript: true, fileIo: true }), risk: [], excludedByDefault: false },
  { key: 'github', name: 'GitHub', category: 'coding', bundleIds: [], hosts: ['github.com'], automation: { ...full, nativeRules: true }, risk: [], excludedByDefault: false },
  { key: 'terminal', name: 'Terminal', category: 'terminal', bundleIds: ['com.apple.Terminal', 'com.googlecode.iterm2'], hosts: [], automation: A({ desktopScript: true, fileIo: true }), risk: ['irreversible'], excludedByDefault: false },
  // notes / ai
  { key: 'apple_notes', name: 'Notes', category: 'notes', bundleIds: ['com.apple.Notes'], hosts: [], automation: A({ desktopScript: true }), risk: [], excludedByDefault: false },
  { key: 'ai_chat', name: 'AI assistant (web)', category: 'ai_assistant', bundleIds: ['com.anthropic.claudefordesktop', 'com.openai.chat'], hosts: ['claude.ai', 'chatgpt.com', 'gemini.google.com'], automation: A({ api: true }), risk: [], excludedByDefault: false },
  // browsers (container; real app is resolved from host when possible)
  { key: 'browser', name: 'Web browser', category: 'browser', bundleIds: ['com.google.Chrome', 'com.apple.Safari', 'org.mozilla.firefox', 'company.thebrowser.Browser', 'com.brave.Browser'], hosts: [], automation: A({}), risk: [], excludedByDefault: false },
  // excluded by default
  { key: 'password_manager', name: 'Password manager', category: 'password_manager', bundleIds: ['com.1password.1password', 'com.agilebits.onepassword7', 'com.bitwarden.desktop', 'com.apple.Passwords', 'com.apple.keychainaccess'], hosts: ['my.1password.com', 'vault.bitwarden.com'], automation: A({}), risk: ['credentials'], excludedByDefault: true },
  { key: 'health_portal', name: 'Health portal', category: 'health', bundleIds: ['com.apple.Health'], hosts: ['mychart.org', 'patient.portal'], automation: A({}), risk: ['health', 'pii'], excludedByDefault: true },
];

export const APP_BY_KEY: ReadonlyMap<string, AppDef> = new Map(APPS.map((a) => [a.key, a]));

/** `gmail`, `google_sheets`, or `other:some-app` */
export const AppKey = z
  .string()
  .regex(/^([a-z0-9_]+|other:[a-z0-9._-]{1,64})$/)
  .meta({ id: 'AppKey' });
export type AppKey = z.infer<typeof AppKey>;

/** Resolve a URL host (+ optional first path segment) to an AppKey. */
export function appKeyForHost(host: string, path = ''): string | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  const firstSeg = path.split('/').filter(Boolean)[0] ?? '';
  for (const app of APPS) {
    for (const ah of app.hosts) {
      const [ahHost, ahPath] = ah.replace(/^www\./, '').split('/', 2) as [string, string | undefined];
      const hostMatch = h === ahHost || h.endsWith('.' + ahHost);
      if (hostMatch && (!ahPath || ahPath === firstSeg)) return app.key;
    }
  }
  return null;
}

export function appKeyForBundleId(bundleId: string): string | null {
  for (const app of APPS) if (app.bundleIds.includes(bundleId)) return app.key;
  return null;
}
