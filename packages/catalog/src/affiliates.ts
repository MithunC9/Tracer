import { AffiliateRecord } from '@tracer/schema';

/**
 * Affiliate registry. Kept in its own module and joined to ranked results only in
 * `disclose.ts` / `recommendTools`. `rank.ts` must never import this file (a test enforces it).
 *
 * PLACEHOLDER DATA: every record below is invented for development. No affiliate agreement
 * exists with any of these vendors, the URLs point at example.com, and the rates are made up.
 * Replace with real, signed programmes before launch, and keep the disclosure on every link.
 */
export const AFFILIATES: readonly AffiliateRecord[] = Object.freeze(
  [
    { entryId: 'zapier', programName: 'PLACEHOLDER Zapier Partner Program', url: 'https://affiliates.example.com/zapier?ref=tracer-placeholder', commissionRate: 0.2 },
    { entryId: 'make', programName: 'PLACEHOLDER Make Affiliate Program', url: 'https://affiliates.example.com/make?ref=tracer-placeholder', commissionRate: 0.35 },
    { entryId: 'pandadoc', programName: 'PLACEHOLDER PandaDoc Referral', url: 'https://affiliates.example.com/pandadoc?ref=tracer-placeholder', commissionRate: 0.25 },
    { entryId: 'textexpander', programName: 'PLACEHOLDER TextExpander Affiliates', url: 'https://affiliates.example.com/textexpander?ref=tracer-placeholder', commissionRate: 0.3 },
    { entryId: 'dext', programName: 'PLACEHOLDER Dext Partner Referral', url: 'https://affiliates.example.com/dext?ref=tracer-placeholder', commissionRate: 0.15 },
    { entryId: 'superhuman', programName: 'PLACEHOLDER Superhuman Referral', url: 'https://affiliates.example.com/superhuman?ref=tracer-placeholder', commissionRate: 0.1 },
  ].map((r) => Object.freeze(AffiliateRecord.parse(r))),
);
