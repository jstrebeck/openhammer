import { registerFaction, registerFactionStateHandlers } from './registry';
import { astraMilitarum, astraMilitarumStateHandlers } from './astra-militarum';

registerFaction(astraMilitarum);
registerFactionStateHandlers('astra-militarum', astraMilitarumStateHandlers);
