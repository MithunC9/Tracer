import type { Database, Tx, TxOptions } from '../db/database.js';
import type { JobQueue, PipelineJob } from '../jobs/queue.js';
import { AuditsRepo, ExclusionsRepo } from './audits.js';
import { EventsRepo } from './events.js';
import { DevicesRepo, PairingCodesRepo, RefreshTokensRepo, UserKeysRepo, UsersRepo } from './identity.js';
import { PipelineRepo } from './pipeline.js';
import { AccessLogRepo, PrivacyRepo } from './privacy.js';

/** Everything a service may touch inside one tenant transaction. */
export interface Repos {
  readonly userId: string;
  users: UsersRepo;
  keys: UserKeysRepo;
  refreshTokens: RefreshTokensRepo;
  pairing: PairingCodesRepo;
  devices: DevicesRepo;
  audits: AuditsRepo;
  exclusions: ExclusionsRepo;
  events: EventsRepo;
  pipeline: PipelineRepo;
  accessLog: AccessLogRepo;
  privacy: PrivacyRepo;
  /** Jobs enqueued here commit or roll back with the transaction. */
  jobs: { enqueueStage(job: PipelineJob): Promise<void> };
}

export function createRepos(tx: Tx, queue: JobQueue): Repos {
  return {
    userId: tx.userId,
    users: new UsersRepo(tx),
    keys: new UserKeysRepo(tx),
    refreshTokens: new RefreshTokensRepo(tx),
    pairing: new PairingCodesRepo(tx),
    devices: new DevicesRepo(tx),
    audits: new AuditsRepo(tx),
    exclusions: new ExclusionsRepo(tx),
    events: new EventsRepo(tx),
    pipeline: new PipelineRepo(tx),
    accessLog: new AccessLogRepo(tx),
    privacy: new PrivacyRepo(tx),
    jobs: { enqueueStage: (job) => queue.enqueueStage(job, tx) },
  };
}

/** Transaction boundary for services. Fakes implement this in unit tests. */
export interface UnitOfWork {
  run<T>(userId: string, fn: (r: Repos) => Promise<T>, opts?: TxOptions): Promise<T>;
}

export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
  ) {}

  run<T>(userId: string, fn: (r: Repos) => Promise<T>, opts?: TxOptions): Promise<T> {
    return this.db.withTenant(userId, (tx) => fn(createRepos(tx, this.queue)), opts);
  }
}

export type { AuthLookups } from './lookups.js';
