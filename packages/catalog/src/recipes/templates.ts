import { step, type RecipeContext, type RecipeTemplate } from './context.js';

/**
 * Recipe template library. Order matters only for ties (earlier wins), so more specific
 * templates come first. Copy rules: plain, specific, numbered by recipeFor, app display
 * names, no hype words.
 */

const bankReconciliation: RecipeTemplate = {
  id: 'bank-reconciliation-rules',
  description: 'Categorise and match recurring bank feed lines with bank rules.',
  match: (c) => (c.hasCap('bank_reconcile') ? 10 : 0) + (c.hasAction('reconcile') && c.firstOf('accounting') ? 4 : 0),
  build: (c) => {
    if (c.has('xero')) {
      return {
        title: 'Let Xero bank rules match your recurring transactions',
        prerequisites: ['Xero with a live bank feed', 'Adviser or Standard user role in Xero'],
        steps: [
          step('In Xero, open Accounting > Bank accounts and look through the last 90 days of statement lines. Write down the payees that appear every month.', 'xero'),
          step('Go to Accounting > Bank accounts, choose the account, then Manage Account > Bank Rules > Create Rule. Pick "Spend money" or "Receive money".', 'xero'),
          step('Set the condition to "Payee contains" the payee name. Add "Amount equals" only if the amount never changes.', 'xero'),
          step('Fill in the account, tax rate and contact the line should get. Save.', 'xero'),
          step('Repeat for the next five to ten most common payees. That usually covers most lines.', 'xero'),
          step('On the Reconcile tab, rule matches now show as suggestions. Check each one and click OK.', 'xero', 'Xero rules suggest; you still confirm. Keep it that way.'),
        ],
        estSetupMinutes: 45,
        difficulty: 'easy',
      };
    }
    const acct = c.nameOf('your accounting software', 'accounting');
    const acctKey = c.firstOf('accounting');
    const qbo = c.has('quickbooks');
    return {
      title: `Let ${acct} bank rules categorise your recurring transactions`,
      prerequisites: [`${acct} with a connected bank feed`, 'Admin or accountant access'],
      steps: [
        step(`In ${acct}, open the bank transactions screen${qbo ? ' (Transactions > Bank transactions)' : ''} and list the payees that appear every month in the last 90 days.`, acctKey),
        step(`Create a new rule${qbo ? ' (Rules > New rule)' : ''} for the most frequent payee. Use "Description contains" the payee name; add an amount condition only if it never changes.`, acctKey),
        step('Set the category, payee and class or tracking field the transaction should get. Leave automatic confirmation off for now.', acctKey),
        step('Repeat for the next five to ten payees.', acctKey),
        step('Once a week, review the rule-suggested matches and accept them in bulk. Fix any wrong ones by editing the rule, not the transaction.', acctKey),
        step('After a month with no wrong matches, turn on automatic confirmation for the two or three most predictable rules, such as bank fees or rent.', acctKey),
      ],
      estSetupMinutes: 45,
      difficulty: 'easy',
    };
  },
};

const invoiceGeneration: RecipeTemplate = {
  id: 'invoice-generation',
  description: 'Create invoices from a template or recurring schedule instead of retyping them.',
  match: (c) => (c.hasCap('invoice_create') ? 10 : 0),
  build: (c) => {
    const acct = c.nameOf('your invoicing tool', 'accounting', 'payments');
    const acctKey = c.firstOf('accounting', 'payments');
    const source = c.nameOf('the sheet or CRM where the billable work is recorded', 'spreadsheet', 'crm', 'project_management');
    const sourceKey = c.firstOf('spreadsheet', 'crm', 'project_management');
    return {
      title: `Generate invoices in ${acct} from a template`,
      prerequisites: [`${acct} account with your logo and payment terms set`, 'A list of clients you bill regularly'],
      steps: [
        step(`In ${acct}, create one invoice template with your standard line items, payment terms and the email message that goes with it.`, acctKey),
        step(`For clients billed the same amount each period, set up a recurring invoice${acctKey ? ` in ${acct}` : ''} and choose "save as draft" rather than "send automatically".`, acctKey),
        step(`For variable invoices, keep billable items in ${source} with columns for client, description, quantity and rate.`, sourceKey),
        step(`Connect ${source} to ${acct} with Zapier or Make: when a row is marked "ready to bill", create a draft invoice with those lines.`, null, 'If the volume is small, importing a CSV of line items once a month works too.'),
        step(`Each billing day, open the drafts in ${acct}, check amounts and send.`, acctKey),
      ],
      estSetupMinutes: 60,
      difficulty: 'moderate',
      keepHumanFor: ['Approve each invoice before it is sent'],
    };
  },
};

const receiptCapture: RecipeTemplate = {
  id: 'receipt-capture',
  description: 'Forward or photograph receipts once; let a capture tool extract and file them.',
  match: (c) => (c.hasCap('expense_capture') ? 10 : 0) + (c.hasCap('ocr', 'pdf_extract') && c.firstOf('accounting') ? 5 : 0),
  build: (c) => {
    const acct = c.nameOf('your accounting software', 'accounting');
    const acctKey = c.firstOf('accounting');
    const mail = c.nameOf('your email', 'email');
    const mailKey = c.firstOf('email');
    return {
      title: `Capture receipts into ${acct} without retyping`,
      prerequisites: [`${acct} account`, 'A receipt capture tool (for example Dext, Hubdoc or Expensify)'],
      steps: [
        step(`Sign up for a receipt capture tool that connects to ${acct} and link the two accounts.`, acctKey),
        step('Copy the tool\'s unique forwarding email address and save it as a contact called "Receipts".'),
        step(`In ${mail}, create a filter or rule that forwards emails from your regular suppliers (or with "receipt" or "invoice" in the subject) to that address.`, mailKey, 'Start with five suppliers you know; widen later.'),
        step('Install the tool\'s phone app and photograph paper receipts the day you get them.'),
        step('In the capture tool, set default categories for each regular supplier.'),
        step(`Once a week, review the extracted items, correct anything misread, then publish them to ${acct}.`, acctKey),
      ],
      estSetupMinutes: 40,
      difficulty: 'easy',
    };
  },
};

const meetingScheduling: RecipeTemplate = {
  id: 'meeting-scheduling-link',
  description: 'Replace back-and-forth scheduling emails with a booking link.',
  match: (c) => (c.hasCap('calendar_booking') ? 10 : 0) + (c.hasAction('schedule') && c.firstOf('calendar') && c.firstOf('email') ? 6 : 0),
  build: (c) => {
    const cal = c.nameOf('your calendar', 'calendar');
    const calKey = c.firstOf('calendar');
    const mail = c.nameOf('your email', 'email');
    const mailKey = c.firstOf('email');
    return {
      title: 'Send a booking link instead of trading emails',
      prerequisites: [`${cal} that holds all your meetings`, 'A scheduling tool (Calendly, Cal.com, SavvyCal or similar)'],
      steps: [
        step(`Create an account in a scheduling tool and connect ${cal}, so it can see when you are busy.`, calKey),
        step('Create one event type per meeting you book often, for example "30-min intro call". Set length, buffer time and the hours you accept bookings.'),
        step('Add the video link (Zoom, Google Meet or Teams) to the event type so every booking gets one.'),
        step('Add one or two intake questions you normally ask by email.'),
        step(`Save the booking link as a template or text snippet in ${mail}, with one line of context: "Pick any time that suits you here:".`, mailKey),
        step('Book a test meeting with yourself from a private browser window to check the confirmation email and calendar entry.'),
      ],
      estSetupMinutes: 25,
      difficulty: 'easy',
    };
  },
};

const meetingNotes: RecipeTemplate = {
  id: 'meeting-notes-summary',
  description: 'Record and summarise meetings, then send the action items where they belong.',
  match: (c) => (c.hasCap('meeting_notes', 'transcription') ? 10 : 0) + (c.firstOf('meetings') && c.hasAction('compose') ? 3 : 0),
  build: (c) => {
    const meet = c.nameOf('your video-call app', 'meetings');
    const meetKey = c.firstOf('meetings');
    const dest = c.nameOf('the place your notes live', 'docs', 'notes', 'crm', 'project_management');
    const destKey = c.firstOf('docs', 'notes', 'crm', 'project_management');
    return {
      title: `Get meeting notes from ${meet} without writing them up`,
      prerequisites: [`Calendar invites with ${meet} links`, 'A meeting notes tool (Otter, Fathom, Granola or similar)'],
      steps: [
        step('Install a meeting notes tool and connect your calendar so it knows which meetings to record.'),
        step('Set it to record only meetings you choose, not every event on the calendar.', meetKey),
        step('Add one line to your meeting invites saying the call is transcribed.', null, 'Required by law in some places; polite everywhere.'),
        step(`After each call, read the summary, fix names and figures, then copy the action items into ${dest}.`, destKey),
        step(`If the tool connects to ${dest}, turn on the integration so summaries arrive there automatically once you approve them.`, destKey),
      ],
      estSetupMinutes: 20,
      difficulty: 'easy',
      keepHumanFor: ['Check the summary before it is shared with anyone outside the call'],
    };
  },
};

const socialPosting: RecipeTemplate = {
  id: 'social-posting-schedule',
  description: 'Batch social posts once a week and schedule them.',
  match: (c) => (c.hasCap('scheduling_social') ? 10 : 0) + (c.has('linkedin') && c.hasAction('compose') ? 4 : 0),
  build: (c) => ({
    title: 'Write social posts in one batch and schedule them',
    prerequisites: ['A scheduling tool such as Buffer', 'Admin access to the accounts you post to'],
    steps: [
      step('Connect your social accounts to the scheduling tool.', c.has('linkedin') ? 'linkedin' : null),
      step('Set a posting schedule, for example Tuesday and Thursday at 9:00, so you fill slots rather than pick times.'),
      step('Block one hour a week in your calendar to write all of next week\'s posts in one go.'),
      step(`Keep a running list of post ideas in ${c.nameOf('a notes doc', 'docs', 'notes', 'spreadsheet')} so the weekly hour starts with material.`, c.firstOf('docs', 'notes', 'spreadsheet')),
      step('Draft, attach images, and add each post to the queue.'),
      step('Check the queue on Monday morning for anything out of date.'),
    ],
    estSetupMinutes: 20,
    difficulty: 'easy',
  }),
};

const csvPipeline: RecipeTemplate = {
  id: 'csv-export-clean-import',
  description: 'Export, clean and import a file on a schedule without manual cleanup.',
  match: (c) =>
    (c.hasCap('csv_transform') ? 7 : 0) +
    (c.hasAction('export') && c.hasAction('import', 'upload', 'paste') ? 5 : 0) +
    (c.firstOf('spreadsheet') ? 1 : 0),
  build: (c) => {
    const exp = c.stepWith('export', 'download');
    const src = exp?.appKey ?? c.pathApps()[0] ?? null;
    const srcName = src ? c.name(src) : 'the source app';
    const imp = c.stepWith('import', 'upload', 'paste');
    const dst = imp && imp.appKey !== src ? imp.appKey : (c.pathApps().find((a) => a !== src) ?? null);
    const dstName = dst ? c.name(dst) : 'the destination';
    const sheet = c.has('excel') ? 'excel' : c.has('google_sheets') ? 'google_sheets' : null;
    const cleaning =
      sheet === 'excel'
        ? step('Open the export in Excel and use Data > Get Data > From File to load it into Power Query. Record each cleaning step there (remove columns, fix dates, split names).', 'excel', 'Power Query replays these steps on next week\'s file with one Refresh.')
        : sheet === 'google_sheets'
          ? step('Make a Google Sheet with two tabs: "raw" (paste or import the export here) and "clean" (formulas that reshape it: QUERY, SPLIT, DATEVALUE).', 'google_sheets', 'The clean tab updates when new raw data arrives.')
          : step('Load the export into a spreadsheet and write down every manual change you make, in order. That list becomes your cleaning steps.');
    return {
      title: `Export from ${srcName}, clean and import into ${dstName} without manual edits`,
      prerequisites: [`Export access in ${srcName}`, `Import access in ${dstName}`, 'One recent export file to practise on'],
      steps: [
        step(`In ${srcName}, save the export settings (columns, filters, date range) so every export comes out the same.`, src, 'Many apps offer a saved report or scheduled export; use it if available.'),
        cleaning,
        step(`Check the column names ${dstName} expects on import and rename your clean columns to match exactly.`, dst),
        step(`Run one import into ${dstName} with the cleaned file and spot-check five rows.`, dst),
        step(`To remove the remaining clicks, connect ${srcName} and ${dstName} with Zapier, Make or n8n (or Sheetgo for sheet-to-sheet), or ask someone technical for a short Python script on a schedule.`),
        step('Keep the original export for each run in a dated folder for a month, in case a row needs tracing.'),
      ],
      estSetupMinutes: 60,
      difficulty: 'moderate',
    };
  },
};

const crmEntry: RecipeTemplate = {
  id: 'crm-entry-from-email',
  description: 'Create or update CRM records from email or LinkedIn without copy-paste.',
  match: (c) =>
    (c.hasCap('crm_sync') ? 7 : 0) +
    (c.firstOf('crm') && (c.firstOf('email') || c.has('linkedin')) ? 4 : 0) +
    (c.hasAction('copy', 'paste') && c.firstOf('crm') ? 1 : 0),
  build: (c) => {
    const crm = c.nameOf('your CRM', 'crm');
    const crmKey = c.firstOf('crm');
    const mail = c.nameOf('your email', 'email');
    const mailKey = c.firstOf('email');
    const li = c.has('linkedin');
    return {
      title: `Get contacts into ${crm} without copy-paste`,
      prerequisites: [`${crm} account with permission to add contacts`, `${mail} account`],
      steps: [
        step(`Install ${crm}'s official extension or add-on for ${mail}, so you can log an email and create a contact from the message itself.`, mailKey),
        step(`In ${crm}, turn on automatic logging of email threads with existing contacts, if it offers it.`, crmKey),
        ...(li
          ? [step(`For LinkedIn profiles, use ${crm}'s browser extension or a contact-capture tool to save a profile one click at a time.`, 'linkedin', 'Bulk scraping usually breaks LinkedIn\'s terms; keep it per-contact.')]
          : []),
        step(`Decide the five fields you actually use (name, company, email, source, next step) and hide the rest in ${crm}'s create form.`, crmKey),
        step(`For anything still copied by hand, set up a Zapier or Make flow: new email with a label "to CRM" in ${mail} creates or updates the contact in ${crm}.`),
        step(`Once a week, filter ${crm} for contacts created in the last 7 days and fix duplicates.`, crmKey),
      ],
      estSetupMinutes: 45,
      difficulty: 'easy',
    };
  },
};

const emailTriage: RecipeTemplate = {
  id: 'email-triage-filters',
  description: 'Sort incoming mail with filters or rules, and keep only what needs you in the inbox.',
  match: (c) =>
    (c.firstOf('email') ? 2 : 0) +
    (c.hasCap('trigger_email') ? 3 : 0) +
    (c.hasCap('email_parse', 'llm_classify') ? 3 : 0) +
    (c.hasAction('read', 'review') && c.firstOf('email') ? 1 : 0),
  build: (c) => {
    if (c.has('outlook')) {
      return {
        title: 'Sort Outlook mail with rules so the inbox only holds what needs you',
        prerequisites: ['Outlook (web or desktop)', 'Two weeks of typical mail to look at'],
        steps: [
          step('Look through the last two weeks of mail and group it: receipts, notifications, newsletters, mail from clients, mail needing a reply.', 'outlook'),
          step('Create folders for each group except "needs a reply".', 'outlook'),
          step('Go to Settings > Mail > Rules > Add new rule. Condition: "From" the notification senders. Action: "Move to" the matching folder.', 'outlook', 'Rules made here are server-side and run when Outlook is closed.'),
          step('Add a rule for newsletters with "Subject includes" or "From" conditions, moving them to a Reading folder.', 'outlook'),
          step('Add a rule that flags or categorises mail from your top clients so it stands out.', 'outlook'),
          step('Check the folders once a day for a week; adjust any rule that catches the wrong mail.', 'outlook'),
        ],
        estSetupMinutes: 30,
        difficulty: 'easy',
      };
    }
    const mail = c.nameOf('your email', 'email');
    const mailKey = c.firstOf('email');
    const gmail = c.has('gmail');
    return {
      title: `Sort ${mail} with ${gmail ? 'filters' : 'rules'} so the inbox only holds what needs you`,
      prerequisites: [`${mail} account`, 'Two weeks of typical mail to look at'],
      steps: [
        step('Look through the last two weeks of mail and group it: receipts, notifications, newsletters, client mail, mail needing a reply.', mailKey),
        step(gmail ? 'In Gmail, create a label for each group except "needs a reply".' : `In ${mail}, create a folder for each group except "needs a reply".`, mailKey),
        step(
          gmail
            ? 'Open a typical notification email, choose More > Filter messages like these, then "Skip the Inbox" and "Apply the label". Tick "Also apply to matching conversations".'
            : `Create a rule in ${mail} for notification senders that moves them to their folder.`,
          mailKey,
        ),
        step(gmail ? 'Repeat for newsletters and receipts. Use "from:" for senders and "subject:" for words in the subject line.' : 'Repeat for newsletters and receipts.', mailKey),
        step(gmail ? 'Add a filter that stars or marks important mail from your top clients.' : 'Add a rule that flags mail from your top clients.', mailKey),
        step('Check the labels once a day for a week; edit any filter that catches the wrong mail.', mailKey),
      ],
      estSetupMinutes: 30,
      difficulty: 'easy',
      keepHumanFor: c.input.requirements.involvesJudgement ? ['Decide the replies yourself; filters only sort'] : [],
    };
  },
};

const replyTemplates: RecipeTemplate = {
  id: 'support-reply-templates',
  description: 'Turn replies you type again and again into saved templates or snippets.',
  match: (c) =>
    (c.hasCap('email_templates', 'text_expansion') ? 7 : 0) +
    (c.firstOf('support') ? 4 : 0) +
    (c.hasAction('compose') && c.firstOf('email', 'support', 'chat') ? 2 : 0),
  build: (c) => {
    const app = c.firstOf('support', 'email', 'chat');
    const appName = app ? c.name(app) : 'your email or helpdesk';
    const inSupport = app !== null && c.categoryOf(app) === 'support';
    const gmail = app === 'gmail';
    const outlook = app === 'outlook';
    const where = inSupport
      ? `In ${appName}, create a macro or saved reply for each one`
      : gmail
        ? 'In Gmail, turn on Templates (Settings > Advanced) and save each answer with More > Templates > Save draft as template'
        : outlook
          ? 'In Outlook, save each answer with My Templates (new Outlook) or Quick Parts (classic Outlook)'
          : `Save each answer as a template in ${appName}, or as a snippet in a text expander (Espanso, TextExpander, Raycast)`;
    return {
      title: `Save your repeat replies as templates in ${appName}`,
      prerequisites: [`${appName} account`, 'Ten recent replies you wrote more than once'],
      steps: [
        step('Collect ten recent replies you have written more than once. Group the ones that say the same thing.', app),
        step('Write one clean version of each, with a placeholder like [NAME] or [DATE] where details change.'),
        step(`${where}.`, app),
        step('Give each a name you will remember when typing, such as "refund-policy" or "intro-call".'),
        step('If you also type these in other apps, add the same text to a text expander so a short abbreviation fills it in anywhere.', null, 'Espanso is free; TextExpander supports shared team libraries.'),
        step('Review the set monthly; delete templates you never use and update ones that went out of date.'),
      ],
      estSetupMinutes: 30,
      difficulty: 'easy',
      keepHumanFor: ['Read each templated reply before sending; fill every placeholder'],
    };
  },
};

const weeklyReport: RecipeTemplate = {
  id: 'weekly-report-assembly',
  description: 'Assemble a recurring report from live data instead of copying numbers by hand.',
  match: (c) =>
    (c.hasCap('trigger_schedule') && c.hasCap('spreadsheet_rw', 'doc_generation', 'llm_summarize', 'data_lookup') ? 6 : 0) +
    (c.hasCap('data_lookup') ? 2 : 0) +
    (/\b(report|weekly|monthly|summary|dashboard|kpi)/i.test(c.label) ? 3 : 0),
  build: (c) => {
    const sheet = c.has('excel') ? 'excel' : c.has('google_sheets') ? 'google_sheets' : null;
    const sheetName = sheet ? c.name(sheet) : 'a spreadsheet';
    const sources = c.pathApps().filter((a) => a !== sheet && c.categoryOf(a) !== 'email' && c.categoryOf(a) !== 'chat');
    const srcText = sources.length ? c.list(sources) : 'each source app';
    const out = c.nameOf('email', 'email', 'chat');
    return {
      title: `Build the recurring report in ${sheetName} from live data`,
      prerequisites: [`${sheet ? `A ${sheetName} file` : 'A spreadsheet'} you can share`, `Read access to ${srcText}`, 'Last week\'s report as a reference'],
      steps: [
        step('List every number in last week\'s report and where it came from.'),
        step(`Make a ${sheetName} file with one "data" tab per source and one "report" tab that only holds formulas pointing at the data tabs.`, sheet),
        step(
          `Feed the data tabs automatically: ${sheet === 'google_sheets' ? 'IMPORTRANGE or IMPORTDATA for other sheets and CSV links, a connector add-on (such as Coefficient) for CRMs and billing tools' : sheet === 'excel' ? 'Power Query for files and databases, a connector add-on for CRMs and billing tools' : 'a connector add-on or a scheduled export from each source'}.`,
          sheet,
          'Set the refresh to run before you usually write the report.',
        ),
        step(`Check this week's figures against ${srcText} by hand once, to confirm the formulas match.`),
        step(`Send the report tab to its readers through ${out}, with a scheduled send or an automation on the refresh.`, c.firstOf('email', 'chat')),
        step('Write the two or three sentences of commentary yourself; that part is where your judgement adds value.'),
      ],
      estSetupMinutes: 90,
      difficulty: 'moderate',
    };
  },
};

const docGeneration: RecipeTemplate = {
  id: 'document-from-template',
  description: 'Generate proposals, contracts or letters from a template filled with record data.',
  match: (c) => (c.hasCap('doc_generation') ? 8 : 0) + (c.firstOf('docs') && c.hasAction('copy', 'paste') ? 2 : 0),
  build: (c) => {
    const doc = c.nameOf('your documents app', 'docs');
    const docKey = c.firstOf('docs');
    const src = c.nameOf('the sheet or CRM that holds the details', 'crm', 'spreadsheet');
    const srcKey = c.firstOf('crm', 'spreadsheet');
    return {
      title: `Fill ${doc} templates from ${src} instead of editing copies`,
      prerequisites: [`A recent finished document in ${doc} to use as the model`, `Details for each document kept in ${src}`],
      steps: [
        step(`Take a finished document and replace each changing detail with a clear placeholder such as {{client_name}} or {{start_date}}. Save it as the template.`, docKey),
        step(`Make sure ${src} has one field per placeholder, with matching names.`, srcKey),
        step('Choose a generator: a document tool such as PandaDoc or Docupilot, a Zapier or Make "create document from template" step, or Google Apps Script for Google Docs.'),
        step(`Map each placeholder to its field in ${src} and generate one test document.`),
        step('Compare the test document with the original, line by line, and fix any mapping.'),
        step('Save generated documents to a dated folder with the client name in the file name.'),
      ],
      estSetupMinutes: 60,
      difficulty: 'moderate',
      keepHumanFor: ['Read each generated document before it is sent or signed'],
    };
  },
};

const fileOrganise: RecipeTemplate = {
  id: 'file-rename-move',
  description: 'Rename and file documents automatically by rules.',
  match: (c) => (c.hasCap('file_move', 'trigger_file') ? 8 : 0) + (c.firstOf('files') ? 2 : 0),
  build: (c) => {
    const files = c.nameOf('your file storage', 'files');
    const filesKey = c.firstOf('files');
    return {
      title: 'File and rename documents by rules instead of by hand',
      prerequisites: ['A clear folder structure you want files to end up in', 'A folder-rule tool: Hazel (Mac), Power Automate for desktop (Windows), or an automation platform for cloud drives'],
      steps: [
        step('Write down the naming pattern you want, for example "2026-11-20 Supplier Invoice 1234.pdf", and the folder each kind of file belongs in.'),
        step(`Pick the folder where these files arrive (often Downloads or an email attachments folder in ${files}).`, filesKey),
        step('Create one rule per kind of file: match by name, sender or text inside the file, then rename with the pattern and move to the target folder.', null, 'Hazel and Power Automate can read PDF text to match on supplier names.'),
        step('Test each rule on copies of three real files in a scratch folder.'),
        step('Turn the rules on for the real folder. Check the target folders daily for the first week.'),
      ],
      estSetupMinutes: 40,
      difficulty: 'easy',
    };
  },
};

const browserFormFill: RecipeTemplate = {
  id: 'browser-form-fill',
  description: 'Fill the same web form from a list of rows with a browser automation tool.',
  match: (c) => (c.hasCap('browser_automation') ? 7 : 0) + (c.has('browser') && c.hasAction('paste') ? 2 : 0),
  build: (c) => {
    const sheet = c.nameOf('a spreadsheet', 'spreadsheet');
    const sheetKey = c.firstOf('spreadsheet');
    return {
      title: `Fill the web form from ${sheet} with a browser automation`,
      prerequisites: [`The data to enter, one row per submission, in ${sheet}`, 'A browser automation tool (UI.Vision, Bardeen, or Playwright if you code)'],
      steps: [
        step(`Clean the rows in ${sheet}: one column per form field, in the order the form asks for them.`, sheetKey),
        step('Check whether the site offers an import or API first; if it does, use that instead and skip the rest.'),
        step('Record yourself filling the form once with the automation tool, then replace the typed values with references to the sheet columns.'),
        step('Add a step that waits for the confirmation message and records success or failure in a new column.'),
        step('Run it on three rows while watching, then on the rest in small batches.'),
      ],
      estSetupMinutes: 90,
      difficulty: 'moderate',
      keepHumanFor: ['Watch the first run and confirm each submission went through'],
    };
  },
};

const copyPasteConnector: RecipeTemplate = {
  id: 'copy-paste-connector',
  description: 'Replace copying data between two web apps with a no-code connector.',
  match: (c) => (c.hasAction('copy') && c.hasAction('paste') && c.pathApps().length >= 2 ? 6 : 0) + (c.hasCap('spreadsheet_rw', 'task_create', 'chat_notify') ? 1 : 0),
  build: (c) => {
    const copyStep = c.stepWith('copy');
    const pasteStep = [...c.input.canonicalPath].reverse().find((s) => s.action === 'paste');
    const from = copyStep?.appKey ?? c.pathApps()[0] ?? null;
    const to = pasteStep && pasteStep.appKey !== from ? pasteStep.appKey : (c.pathApps().find((a) => a !== from) ?? null);
    const fromName = from ? c.name(from) : 'the first app';
    const toName = to ? c.name(to) : 'the second app';
    return {
      title: `Move data from ${fromName} to ${toName} with a connector instead of copy-paste`,
      prerequisites: [`Accounts in ${fromName} and ${toName}`, 'A connector platform account (Zapier, Make or n8n)'],
      steps: [
        step(`Write down exactly which fields you copy from ${fromName} and where each goes in ${toName}.`, from),
        step(`In the connector platform, start a new automation triggered in ${fromName} when the record you copy is created or updated.`, from, 'If there is no trigger for it, a scheduled "search for new records" step works.'),
        step(`Add a ${toName} action that creates or updates the matching record, and map each field from your list.`, to),
        step('Add a lookup step so it updates an existing record instead of creating a duplicate.'),
        step('Run it with one test record, compare the result with what you would have pasted, and switch it on.'),
        step('Turn on error notifications so a failed run reaches you by email.'),
      ],
      estSetupMinutes: 45,
      difficulty: 'easy',
    };
  },
};

/** Fallback when nothing else matches. Built from the path itself. */
export const GENERIC_TEMPLATE: RecipeTemplate = {
  id: 'generic',
  description: 'Fallback: write the steps down, remove what a tool can do, keep the judgement.',
  match: () => 0,
  build: (c: RecipeContext) => {
    const apps = c.pathApps();
    const appsText = apps.length ? c.list(apps) : 'the apps involved';
    return {
      title: `Cut the manual steps out of "${c.label}"`,
      prerequisites: [`Access to ${appsText}`, 'Twenty minutes to watch yourself do it once'],
      steps: [
        step(`Do the task once and write down each step in order: ${c.input.canonicalPath.slice(0, 6).map((s) => s.label).join(' → ')}.`),
        step('Mark each step as "rule" (same every time) or "judgement" (you decide).'),
        step(`Check whether ${appsText} have built-in rules, templates or scheduled exports for the "rule" steps, and set those up first.`, apps[0] ?? null),
        step('For steps that move data between apps, try a connector platform (Zapier, Make or n8n) with one test record.'),
        step('Keep the "judgement" steps as a short checklist and do them yourself.'),
      ],
      estSetupMinutes: 60,
      difficulty: 'moderate',
    };
  },
};

export const TEMPLATES: readonly RecipeTemplate[] = [
  bankReconciliation,
  invoiceGeneration,
  receiptCapture,
  meetingScheduling,
  meetingNotes,
  socialPosting,
  csvPipeline,
  crmEntry,
  emailTriage,
  replyTemplates,
  weeklyReport,
  docGeneration,
  fileOrganise,
  browserFormFill,
  copyPasteConnector,
];
