import type { AccessLogEntry, DeletionReceipt } from '@tracer/schema';
import type { PrivacyItem } from '../domain/Privacy.js';

export { sampleReport } from './sample-report.js';

export const sampleAccessLog: AccessLogEntry[] = [
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c01', at: '2026-11-23T07:14:09.000Z', actor: 'system', actorId: 'pipeline', action: 'report.publish', resource: 'audit/6f1d…3a4b/report', requestId: 'req_7Hq2kD' },
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c02', at: '2026-11-23T07:02:51.000Z', actor: 'system', actorId: 'pipeline', action: 'events.read', resource: 'audit/6f1d…3a4b/events', requestId: 'req_7Hp9xA' },
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c03', at: '2026-11-22T18:31:40.000Z', actor: 'device', actorId: 'dev_mara-mbp', action: 'events.write', resource: 'audit/6f1d…3a4b/events (412)', requestId: 'req_6zT1mB' },
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c04', at: '2026-11-22T09:12:03.000Z', actor: 'user', actorId: null, action: 'exclusions.update', resource: 'settings/exclusions', requestId: 'req_6yR0aQ' },
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c05', at: '2026-11-21T16:45:22.000Z', actor: 'user', actorId: null, action: 'status.read', resource: 'audit/6f1d…3a4b/status', requestId: 'req_6wK8cE' },
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c06', at: '2026-11-16T08:00:12.000Z', actor: 'device', actorId: 'dev_mara-mbp', action: 'device.pair', resource: 'devices/dev_mara-mbp', requestId: null },
];

export const sampleDeletionReceipt: DeletionReceipt = {
  receiptId: '9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  subjectHash: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
  requestedAt: '2026-11-24T10:02:11.000Z',
  completedAt: '2026-11-24T10:02:14.000Z',
  tables: [
    { table: 'events', rowsDeleted: 18442 },
    { table: 'stage_outputs', rowsDeleted: 8 },
    { table: 'reports', rowsDeleted: 1 },
    { table: 'audits', rowsDeleted: 1 },
    { table: 'devices', rowsDeleted: 1 },
    { table: 'sessions', rowsDeleted: 4 },
    { table: 'access_log', rowsDeleted: 37 },
    { table: 'users', rowsDeleted: 1 },
  ],
  derivedDataPurge: 'complete',
  signature: '5f0d9c1e7a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d',
};

export const samplePrivacy: { captured: PrivacyItem[]; notCaptured: PrivacyItem[] } = {
  captured: [
    { item: 'Which app is in front, and when', note: 'App name and a start and end time.' },
    { item: 'Window titles, redacted', note: 'Card numbers, emails, phone numbers and tokens are removed on your Mac.' },
    { item: 'Website host only', note: 'mail.google.com, never the full address.' },
    { item: 'That you copied or pasted', note: 'The fact and the kind (text, image), not the content.' },
    { item: 'Idle and pause periods', note: 'So breaks do not count as work.' },
  ],
  notCaptured: [
    { item: 'Screenshots or screen recordings' },
    { item: 'Keystrokes' },
    { item: 'Clipboard contents' },
    { item: 'Full URLs or page contents' },
    { item: 'Anything in excluded apps', note: 'Password managers, banking and health are excluded by default.' },
    { item: 'Anything while paused or in private windows' },
  ],
};
