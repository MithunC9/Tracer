import type { PersonaDef } from '../engine.js';
import type { PersonaId } from '../paths.js';
import { agency_am } from './agency_am.js';
import { bookkeeper } from './bookkeeper.js';
import { founder } from './founder.js';
import { freelancer } from './freelancer.js';
import { ops_manager } from './ops_manager.js';

export const PERSONA_DEFS: Record<PersonaId, PersonaDef> = {
  freelancer,
  ops_manager,
  bookkeeper,
  agency_am,
  founder,
};
