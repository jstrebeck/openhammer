import { registerEdition } from '../rules/registry';
import { wh40k10thEdition } from './wh40k10th';

// Auto-register all editions on import
registerEdition(wh40k10thEdition);

export { wh40k10thEdition };
