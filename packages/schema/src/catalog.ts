import { z } from 'zod';

/**
 * Catalog contract. NOTE: `CatalogEntry` deliberately has NO commission/affiliate fields.
 * Affiliate data lives in a separate `AffiliateRecord` registry that is joined only AFTER
 * ranking. The ranking function's type signature therefore cannot see commission data.
 */
export const CapabilityTag = z.enum([
  'trigger_schedule',
  'trigger_email',
  'trigger_webhook',
  'trigger_file',
  'trigger_form',
  'email_parse',
  'email_send',
  'email_templates',
  'spreadsheet_rw',
  'csv_transform',
  'pdf_extract',
  'ocr',
  'file_move',
  'crm_sync',
  'calendar_booking',
  'meeting_notes',
  'transcription',
  'doc_generation',
  'invoice_create',
  'bank_reconcile',
  'expense_capture',
  'text_expansion',
  'browser_automation',
  'desktop_automation',
  'llm_summarize',
  'llm_draft',
  'llm_classify',
  'data_lookup',
  'approval_step',
  'chat_notify',
  'task_create',
  'code_automation',
  'scheduling_social',
]);
export type CapabilityTag = z.infer<typeof CapabilityTag>;

export const ToolCategory = z.enum([
  'automation_platform',
  'native_feature',
  'script',
  'email',
  'scheduling',
  'spreadsheet',
  'crm',
  'docs',
  'meetings',
  'coding',
  'finance_ops',
  'ai_assistant',
  'text_expansion',
]);
export type ToolCategory = z.infer<typeof ToolCategory>;

export const PricingTier = z.enum(['free', 'freemium', 'paid', 'included']);
export type PricingTier = z.infer<typeof PricingTier>;

export const SetupEffort = z.enum(['minutes', 'hour', 'afternoon', 'days']);
export type SetupEffort = z.infer<typeof SetupEffort>;

export const SkillLevel = z.enum(['none', 'some', 'technical']);
export type SkillLevel = z.infer<typeof SkillLevel>;

export const CatalogEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    vendor: z.string(),
    category: ToolCategory,
    summary: z.string().max(240),
    capabilities: z.array(CapabilityTag).min(1),
    /** AppKeys this tool integrates with natively. `*` = generic (browser/desktop automation). */
    integrations: z.array(z.string()),
    platforms: z.array(z.enum(['macos', 'windows', 'linux', 'web', 'ios', 'android'])).min(1),
    pricingTier: PricingTier,
    priceNote: z.string().max(120),
    setupEffort: SetupEffort,
    skillLevel: SkillLevel,
    reliabilityNotes: z.string().max(240),
    url: z.url(),
    /** Self-hostable / open-source: relevant for privacy-minded users. */
    openSource: z.boolean(),
  })
  .strict()
  .meta({ id: 'CatalogEntry' });
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/** Kept separate from CatalogEntry on purpose. Never passed to ranking. */
export const AffiliateRecord = z
  .object({
    entryId: z.string(),
    url: z.url(),
    programName: z.string(),
    /** Stored for accounting only. Must never influence ranking. */
    commissionRate: z.number().min(0).max(1),
  })
  .meta({ id: 'AffiliateRecord' });
export type AffiliateRecord = z.infer<typeof AffiliateRecord>;

/** What a workflow cluster needs from a tool. Produced by the pipeline. */
export const ClusterRequirements = z
  .object({
    capabilities: z.array(CapabilityTag).min(1),
    apps: z.array(z.string()),
    trigger: z.enum(['schedule', 'event', 'manual']),
    involvesJudgement: z.boolean(),
  })
  .meta({ id: 'ClusterRequirements' });
export type ClusterRequirements = z.infer<typeof ClusterRequirements>;

export const UserConstraints = z
  .object({
    platform: z.enum(['macos', 'windows', 'linux']),
    budget: z.enum(['free_only', 'low', 'any']),
    skill: SkillLevel,
    preferOpenSource: z.boolean(),
  })
  .meta({ id: 'UserConstraints' });
export type UserConstraints = z.infer<typeof UserConstraints>;

export const DEFAULT_CONSTRAINTS: UserConstraints = {
  platform: 'macos',
  budget: 'any',
  skill: 'some',
  preferOpenSource: false,
};

export const FitReason = z.object({
  factor: z.enum(['capability', 'integration', 'platform', 'budget', 'skill', 'effort', 'open_source']),
  /** Signed contribution to fit score, for transparency. */
  delta: z.number(),
  note: z.string(),
});
export type FitReason = z.infer<typeof FitReason>;

export const RankedTool = z
  .object({
    entryId: z.string(),
    name: z.string(),
    vendor: z.string(),
    rank: z.number().int().positive(),
    /** 0..100, computed from fit only. */
    fitScore: z.number().min(0).max(100),
    reasons: z.array(FitReason),
    pricingTier: PricingTier,
    priceNote: z.string(),
    setupEffort: SetupEffort,
    url: z.url(),
    /** Attached AFTER ranking. Shown with "we may earn a commission". */
    affiliate: z.object({ url: z.url(), disclosure: z.string() }).nullable(),
  })
  .meta({ id: 'RankedTool' });
export type RankedTool = z.infer<typeof RankedTool>;

export const AFFILIATE_DISCLOSURE = 'We may earn a commission if you sign up through this link. It does not affect the ranking.';
