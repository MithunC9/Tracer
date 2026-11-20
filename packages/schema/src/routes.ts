import { z } from 'zod';
import {
  AccessLogEntry,
  AgentConfig,
  Audit,
  CaptureStatus,
  CapturedSummary,
  CreateAuditRequest,
  DeletionReceipt,
  Device,
  Health,
  LoginRequest,
  Me,
  PairDeviceRequest,
  PairDeviceResponse,
  PairingCode,
  Session,
  SignupRequest,
  UpdateMeRequest,
} from './api.js';
import { CatalogEntry } from './catalog.js';
import { Paginated, Uuid } from './common.js';
import { IngestBatch, IngestResult } from './events.js';
import { Exclusions } from './exclusions.js';
import { PipelineRun } from './pipeline.js';
import { AuditReport } from './report.js';

/**
 * The API contract. Every route is declared here once. The API registers handlers
 * against these definitions (fastify-type-provider-zod), OpenAPI is emitted from
 * them, and the web client is typed by them. Changing a route = changing this file.
 *
 * auth:
 *  - public: no credentials
 *  - user:   Authorization: Bearer <access JWT>
 *  - device: Authorization: Bearer <device token>
 *  - refresh: httpOnly refresh cookie + X-CSRF-Token header (double-submit)
 */
export type AuthMode = 'public' | 'user' | 'device' | 'refresh';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  auth: AuthMode;
  summary: string;
  tags: string[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Success response. `null` = 204 No Content. `'binary'` = file download. */
  response: z.ZodType | null | 'binary';
  successStatus?: 200 | 201 | 202 | 204;
}

const r = <T extends RouteDef>(d: T) => d;
const IdParam = z.object({ id: Uuid });
const Ok = z.object({ ok: z.literal(true) });

export const routes = {
  // --- ops
  healthz: r({ method: 'GET', path: '/healthz', auth: 'public', summary: 'Liveness', tags: ['ops'], response: Health }),
  readyz: r({ method: 'GET', path: '/readyz', auth: 'public', summary: 'Readiness (DB, queue)', tags: ['ops'], response: Health }),

  // --- auth
  signup: r({ method: 'POST', path: '/v1/auth/signup', auth: 'public', summary: 'Create account', tags: ['auth'], body: SignupRequest, response: Session, successStatus: 201 }),
  login: r({ method: 'POST', path: '/v1/auth/login', auth: 'public', summary: 'Log in', tags: ['auth'], body: LoginRequest, response: Session }),
  refresh: r({ method: 'POST', path: '/v1/auth/refresh', auth: 'refresh', summary: 'Rotate refresh token, get new access token', tags: ['auth'], response: Session }),
  logout: r({ method: 'POST', path: '/v1/auth/logout', auth: 'refresh', summary: 'Revoke refresh token family', tags: ['auth'], response: null, successStatus: 204 }),

  // --- me
  getMe: r({ method: 'GET', path: '/v1/me', auth: 'user', summary: 'Current user', tags: ['me'], response: Me }),
  updateMe: r({ method: 'PATCH', path: '/v1/me', auth: 'user', summary: 'Update profile / tool constraints', tags: ['me'], body: UpdateMeRequest, response: Me }),
  exportMe: r({ method: 'GET', path: '/v1/me/export', auth: 'user', summary: 'Download all your data as a zip of JSON files', tags: ['privacy'], response: 'binary' }),
  deleteMe: r({ method: 'DELETE', path: '/v1/me', auth: 'user', summary: 'Hard-delete account and all data; returns a signed receipt', tags: ['privacy'], response: DeletionReceipt }),
  accessLog: r({ method: 'GET', path: '/v1/me/access-log', auth: 'user', summary: 'Every access to your data', tags: ['privacy'], query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: Paginated(AccessLogEntry) }),
  capturedSummary: r({ method: 'GET', path: '/v1/me/captured', auth: 'user', summary: 'What we hold about you (counts by kind)', tags: ['privacy'], response: CapturedSummary }),
  getExclusions: r({ method: 'GET', path: '/v1/me/exclusions', auth: 'user', summary: 'Exclude list', tags: ['privacy'], response: Exclusions }),
  putExclusions: r({ method: 'PUT', path: '/v1/me/exclusions', auth: 'user', summary: 'Replace exclude list', tags: ['privacy'], body: Exclusions, response: Exclusions }),

  // --- devices
  createPairingCode: r({ method: 'POST', path: '/v1/devices/pairing-codes', auth: 'user', summary: 'Create a short-lived pairing code to enter in the agent', tags: ['devices'], response: PairingCode, successStatus: 201 }),
  pairDevice: r({ method: 'POST', path: '/v1/devices/pair', auth: 'public', summary: 'Agent exchanges a pairing code for a device token', tags: ['devices'], body: PairDeviceRequest, response: PairDeviceResponse, successStatus: 201 }),
  listDevices: r({ method: 'GET', path: '/v1/devices', auth: 'user', summary: 'List devices', tags: ['devices'], response: z.object({ items: z.array(Device) }) }),
  revokeDevice: r({ method: 'DELETE', path: '/v1/devices/:id', auth: 'user', summary: 'Revoke a device token', tags: ['devices'], params: IdParam, response: null, successStatus: 204 }),

  // --- agent (device-authenticated)
  agentConfig: r({ method: 'GET', path: '/v1/agent/config', auth: 'device', summary: 'Capture window, pause state and exclusions for this device', tags: ['agent'], response: AgentConfig }),
  ingest: r({ method: 'POST', path: '/v1/agent/events', auth: 'device', summary: 'Idempotent batch ingest of redacted events', tags: ['agent'], body: IngestBatch, response: IngestResult, successStatus: 202 }),

  // --- audits
  createAudit: r({ method: 'POST', path: '/v1/audits', auth: 'user', summary: 'Start an audit window (1-14 days)', tags: ['audits'], body: CreateAuditRequest, response: Audit, successStatus: 201 }),
  listAudits: r({ method: 'GET', path: '/v1/audits', auth: 'user', summary: 'List audits', tags: ['audits'], response: z.object({ items: z.array(Audit) }) }),
  getAudit: r({ method: 'GET', path: '/v1/audits/:id', auth: 'user', summary: 'Get audit', tags: ['audits'], params: IdParam, response: Audit }),
  pauseAudit: r({ method: 'POST', path: '/v1/audits/:id/pause', auth: 'user', summary: 'Pause capture', tags: ['audits'], params: IdParam, response: Audit }),
  resumeAudit: r({ method: 'POST', path: '/v1/audits/:id/resume', auth: 'user', summary: 'Resume capture', tags: ['audits'], params: IdParam, response: Audit }),
  finishAudit: r({ method: 'POST', path: '/v1/audits/:id/finish', auth: 'user', summary: 'End capture now and run analysis', tags: ['audits'], params: IdParam, response: Audit, successStatus: 202 }),
  auditStatus: r({ method: 'GET', path: '/v1/audits/:id/status', auth: 'user', summary: 'Live capture counts (never contents)', tags: ['audits'], params: IdParam, response: CaptureStatus }),
  auditPipeline: r({ method: 'GET', path: '/v1/audits/:id/pipeline', auth: 'user', summary: 'Latest pipeline run and per-stage status', tags: ['audits'], params: IdParam, response: PipelineRun.nullable() }),
  rerunPipeline: r({ method: 'POST', path: '/v1/audits/:id/pipeline', auth: 'user', summary: 'Re-run analysis (cached stages reused)', tags: ['audits'], params: IdParam, response: PipelineRun, successStatus: 202 }),
  getReport: r({ method: 'GET', path: '/v1/audits/:id/report', auth: 'user', summary: 'The audit report', tags: ['audits'], params: IdParam, response: AuditReport }),

  // --- catalog (public, read-only)
  listCatalog: r({ method: 'GET', path: '/v1/catalog', auth: 'public', summary: 'Vendor-neutral tool catalog', tags: ['catalog'], response: z.object({ items: z.array(CatalogEntry) }) }),

  // --- plan (stub)
  getPlan: r({ method: 'GET', path: '/v1/plan', auth: 'user', summary: 'Plan (stub, no billing)', tags: ['plan'], response: z.object({ plan: z.enum(['free', 'monthly']), note: z.string() }) }),
  _ok: r({ method: 'GET', path: '/v1/_ok', auth: 'public', summary: 'Contract smoke route', tags: ['ops'], response: Ok }),
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
type InferIn<T> = T extends z.ZodType ? z.input<T> : undefined;
export type RouteResponse<N extends RouteName> = Routes[N]['response'] extends z.ZodType
  ? z.infer<Routes[N]['response']>
  : Routes[N]['response'] extends 'binary'
    ? Blob
    : void;
export type RouteInput<N extends RouteName> = {
  params: Routes[N] extends { params: infer P } ? Infer<P> : undefined;
  query: Routes[N] extends { query: infer Q } ? InferIn<Q> : undefined;
  body: Routes[N] extends { body: infer B } ? InferIn<B> : undefined;
};
