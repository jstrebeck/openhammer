import { registerFaction, registerFactionStateHandlers } from './registry';
import { tauEmpire, tauEmpireStateHandlers } from './tau-empire';

registerFaction(tauEmpire);
registerFactionStateHandlers('tau-empire', tauEmpireStateHandlers);
