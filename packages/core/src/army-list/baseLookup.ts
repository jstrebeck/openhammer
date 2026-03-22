import type { BaseShape } from '../types/index';

/**
 * Lookup table mapping model/unit names to their actual base or hull shape.
 *
 * Sources: GW recommended base sizes PDF, community measurements.
 * Vehicle hull dimensions are approximate (measured from the physical kit).
 *
 * Keys are lowercase for case-insensitive matching.
 */
const BASE_LOOKUP: Record<string, BaseShape> = {
  // --- Imperium: Space Marines (infantry on round bases) ---
  'intercessor': { type: 'circle', diameterMm: 32 },
  'assault intercessor': { type: 'circle', diameterMm: 32 },
  'heavy intercessor': { type: 'circle', diameterMm: 40 },
  'hellblaster': { type: 'circle', diameterMm: 32 },
  'infernus marine': { type: 'circle', diameterMm: 32 },
  'tactical marine': { type: 'circle', diameterMm: 32 },
  'sternguard veteran': { type: 'circle', diameterMm: 32 },
  'scout': { type: 'circle', diameterMm: 28 },
  'terminator': { type: 'circle', diameterMm: 40 },
  'aggressor': { type: 'circle', diameterMm: 40 },
  'eradicator': { type: 'circle', diameterMm: 40 },
  'devastator marine': { type: 'circle', diameterMm: 32 },
  'bladeguard veteran': { type: 'circle', diameterMm: 40 },
  'vanguard veteran': { type: 'circle', diameterMm: 32 },

  // --- Space Marine characters ---
  'captain': { type: 'circle', diameterMm: 40 },
  'lieutenant': { type: 'circle', diameterMm: 40 },
  'chaplain': { type: 'circle', diameterMm: 40 },
  'librarian': { type: 'circle', diameterMm: 40 },
  'apothecary': { type: 'circle', diameterMm: 40 },
  'techmarine': { type: 'circle', diameterMm: 40 },
  'primaris captain': { type: 'circle', diameterMm: 40 },
  'primaris lieutenant': { type: 'circle', diameterMm: 40 },
  'primaris chaplain': { type: 'circle', diameterMm: 40 },
  'primaris librarian': { type: 'circle', diameterMm: 40 },
  'primaris apothecary': { type: 'circle', diameterMm: 40 },

  // --- Space Marine bikes & cavalry (oval bases) ---
  'outrider': { type: 'oval', widthMm: 90, heightMm: 52 },
  'biker': { type: 'oval', widthMm: 75, heightMm: 42 },
  'attack bike': { type: 'oval', widthMm: 75, heightMm: 42 },
  'invader atv': { type: 'oval', widthMm: 90, heightMm: 52 },

  // --- Space Marine walkers/dreads (round) ---
  'redemptor dreadnought': { type: 'circle', diameterMm: 90 },
  'brutalis dreadnought': { type: 'circle', diameterMm: 90 },
  'ballistus dreadnought': { type: 'circle', diameterMm: 90 },
  'venerable dreadnought': { type: 'circle', diameterMm: 60 },
  'dreadnought': { type: 'circle', diameterMm: 60 },
  'contemptor dreadnought': { type: 'circle', diameterMm: 60 },
  'ironclad dreadnought': { type: 'circle', diameterMm: 60 },
  'invictor tactical warsuit': { type: 'circle', diameterMm: 90 },

  // --- Space Marine vehicles (hull measured, rect) ---
  'rhino': { type: 'rect', widthMm: 115, heightMm: 68 },
  'razorback': { type: 'rect', widthMm: 115, heightMm: 68 },
  'impulsor': { type: 'rect', widthMm: 120, heightMm: 75 },
  'repulsor': { type: 'rect', widthMm: 150, heightMm: 95 },
  'repulsor executioner': { type: 'rect', widthMm: 155, heightMm: 95 },
  'predator': { type: 'rect', widthMm: 120, heightMm: 75 },
  'predator annihilator': { type: 'rect', widthMm: 120, heightMm: 75 },
  'predator destructor': { type: 'rect', widthMm: 120, heightMm: 75 },
  'vindicator': { type: 'rect', widthMm: 115, heightMm: 75 },
  'whirlwind': { type: 'rect', widthMm: 115, heightMm: 68 },
  'land raider': { type: 'rect', widthMm: 150, heightMm: 85 },
  'land raider redeemer': { type: 'rect', widthMm: 150, heightMm: 85 },
  'land raider crusader': { type: 'rect', widthMm: 150, heightMm: 85 },
  'gladiator lancer': { type: 'rect', widthMm: 150, heightMm: 95 },
  'gladiator reaper': { type: 'rect', widthMm: 150, heightMm: 95 },
  'gladiator valiant': { type: 'rect', widthMm: 150, heightMm: 95 },

  // --- Space Marine flyers ---
  'stormhawk interceptor': { type: 'oval', widthMm: 170, heightMm: 109 },
  'stormraven gunship': { type: 'oval', widthMm: 170, heightMm: 109 },
  'stormtalon gunship': { type: 'oval', widthMm: 120, heightMm: 92 },

  // --- Imperial Knights ---
  'armiger warglaive': { type: 'oval', widthMm: 130, heightMm: 80 },
  'armiger helverin': { type: 'oval', widthMm: 130, heightMm: 80 },
  'knight paladin': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight errant': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight crusader': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight gallant': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight warden': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight castellan': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight valiant': { type: 'oval', widthMm: 170, heightMm: 109 },

  // --- Astra Militarum infantry ---
  'cadian shock trooper': { type: 'circle', diameterMm: 25 },
  'cadian': { type: 'circle', diameterMm: 25 },
  'guardsman': { type: 'circle', diameterMm: 25 },
  'catachan jungle fighter': { type: 'circle', diameterMm: 25 },
  'tempestus scion': { type: 'circle', diameterMm: 25 },
  'kasrkin': { type: 'circle', diameterMm: 28 },
  'commissar': { type: 'circle', diameterMm: 25 },
  'infantry squad': { type: 'circle', diameterMm: 25 },
  'command squad': { type: 'circle', diameterMm: 25 },
  'ogryn': { type: 'circle', diameterMm: 40 },
  'bullgryn': { type: 'circle', diameterMm: 40 },
  'ratling': { type: 'circle', diameterMm: 25 },

  // --- Astra Militarum characters ---
  'lord castellan': { type: 'circle', diameterMm: 25 },
  'tank commander': { type: 'rect', widthMm: 130, heightMm: 80 },
  'company commander': { type: 'circle', diameterMm: 25 },
  'platoon commander': { type: 'circle', diameterMm: 25 },

  // --- Astra Militarum vehicles ---
  'leman russ battle tank': { type: 'rect', widthMm: 130, heightMm: 80 },
  'leman russ demolisher': { type: 'rect', widthMm: 130, heightMm: 80 },
  'leman russ vanquisher': { type: 'rect', widthMm: 130, heightMm: 80 },
  'leman russ executioner': { type: 'rect', widthMm: 130, heightMm: 80 },
  'leman russ punisher': { type: 'rect', widthMm: 130, heightMm: 80 },
  'leman russ exterminator': { type: 'rect', widthMm: 130, heightMm: 80 },
  'rogal dorn battle tank': { type: 'rect', widthMm: 155, heightMm: 100 },
  'chimera': { type: 'rect', widthMm: 120, heightMm: 70 },
  'taurox': { type: 'rect', widthMm: 105, heightMm: 70 },
  'taurox prime': { type: 'rect', widthMm: 105, heightMm: 70 },
  'hellhound': { type: 'rect', widthMm: 120, heightMm: 70 },
  'basilisk': { type: 'rect', widthMm: 120, heightMm: 70 },
  'manticore': { type: 'rect', widthMm: 120, heightMm: 70 },
  'hydra': { type: 'rect', widthMm: 120, heightMm: 70 },
  'wyvern': { type: 'rect', widthMm: 120, heightMm: 70 },
  'deathstrike': { type: 'rect', widthMm: 120, heightMm: 70 },
  'baneblade': { type: 'rect', widthMm: 225, heightMm: 115 },
  'shadowsword': { type: 'rect', widthMm: 225, heightMm: 115 },
  'sentinel': { type: 'circle', diameterMm: 60 },
  'armoured sentinel': { type: 'circle', diameterMm: 60 },
  'scout sentinel': { type: 'circle', diameterMm: 60 },

  // --- Astra Militarum cavalry ---
  'rough rider': { type: 'oval', widthMm: 60, heightMm: 35 },
  'attilan rough rider': { type: 'oval', widthMm: 60, heightMm: 35 },
  'death rider': { type: 'oval', widthMm: 60, heightMm: 35 },
  'death riders of krieg': { type: 'oval', widthMm: 60, heightMm: 35 },
  'death rider squadron commander': { type: 'oval', widthMm: 60, heightMm: 35 },
  'death rider commissioner': { type: 'oval', widthMm: 60, heightMm: 35 },

  // --- Death Korps of Krieg infantry ---
  'death korps of krieg': { type: 'circle', diameterMm: 25 },
  'death korps marshal': { type: 'circle', diameterMm: 28 },

  // --- Adepta Sororitas ---
  'battle sister': { type: 'circle', diameterMm: 32 },
  'sister of battle': { type: 'circle', diameterMm: 32 },
  'celestian sacresant': { type: 'circle', diameterMm: 32 },
  'retributor': { type: 'circle', diameterMm: 32 },
  'canoness': { type: 'circle', diameterMm: 32 },
  'repentia': { type: 'circle', diameterMm: 28 },
  'seraphim': { type: 'circle', diameterMm: 32 },
  'zephyrim': { type: 'circle', diameterMm: 32 },
  'paragon warsuit': { type: 'circle', diameterMm: 50 },
  'penitent engine': { type: 'circle', diameterMm: 50 },
  'mortifier': { type: 'circle', diameterMm: 50 },
  'exorcist': { type: 'rect', widthMm: 120, heightMm: 70 },
  'immolator': { type: 'rect', widthMm: 115, heightMm: 68 },
  'castigator': { type: 'rect', widthMm: 150, heightMm: 95 },

  // --- Chaos Space Marines ---
  'chaos space marine': { type: 'circle', diameterMm: 32 },
  'legionary': { type: 'circle', diameterMm: 32 },
  'chosen': { type: 'circle', diameterMm: 32 },
  'havoc': { type: 'circle', diameterMm: 32 },
  'possessed': { type: 'circle', diameterMm: 40 },
  'obliterator': { type: 'circle', diameterMm: 50 },
  'chaos terminator': { type: 'circle', diameterMm: 40 },
  'dark apostle': { type: 'circle', diameterMm: 40 },
  'chaos lord': { type: 'circle', diameterMm: 40 },
  'master of possession': { type: 'circle', diameterMm: 40 },
  'helbrute': { type: 'circle', diameterMm: 60 },
  'forgefiend': { type: 'circle', diameterMm: 105 },
  'maulerfiend': { type: 'circle', diameterMm: 105 },
  'defiler': { type: 'circle', diameterMm: 130 },
  'chaos rhino': { type: 'rect', widthMm: 115, heightMm: 68 },
  'chaos land raider': { type: 'rect', widthMm: 150, heightMm: 85 },
  'chaos predator': { type: 'rect', widthMm: 120, heightMm: 75 },
  'chaos vindicator': { type: 'rect', widthMm: 115, heightMm: 75 },

  // --- Chaos Knights ---
  'war dog': { type: 'oval', widthMm: 130, heightMm: 80 },
  'war dog stalker': { type: 'oval', widthMm: 130, heightMm: 80 },
  'war dog executioner': { type: 'oval', widthMm: 130, heightMm: 80 },
  'war dog huntsman': { type: 'oval', widthMm: 130, heightMm: 80 },
  'knight desecrator': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight rampager': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight despoiler': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight abominant': { type: 'oval', widthMm: 170, heightMm: 109 },
  'knight tyrant': { type: 'oval', widthMm: 170, heightMm: 109 },

  // --- Death Guard ---
  'plague marine': { type: 'circle', diameterMm: 32 },
  'poxwalker': { type: 'circle', diameterMm: 25 },
  'blightlord terminator': { type: 'circle', diameterMm: 40 },
  'deathshroud terminator': { type: 'circle', diameterMm: 40 },
  'plagueburst crawler': { type: 'rect', widthMm: 120, heightMm: 85 },
  'foetid bloat-drone': { type: 'circle', diameterMm: 60 },
  'myphitic blight-hauler': { type: 'circle', diameterMm: 60 },

  // --- Thousand Sons ---
  'rubric marine': { type: 'circle', diameterMm: 32 },
  'scarab occult terminator': { type: 'circle', diameterMm: 40 },
  'tzaangor': { type: 'circle', diameterMm: 32 },

  // --- World Eaters ---
  'berzerker': { type: 'circle', diameterMm: 32 },
  'jakhals': { type: 'circle', diameterMm: 28 },
  'eightbound': { type: 'circle', diameterMm: 40 },
  'exalted eightbound': { type: 'circle', diameterMm: 50 },
  'lord invocatus': { type: 'oval', widthMm: 90, heightMm: 52 },
  'angron': { type: 'circle', diameterMm: 100 },

  // --- Orks ---
  'boy': { type: 'circle', diameterMm: 32 },
  'ork boy': { type: 'circle', diameterMm: 32 },
  'nob': { type: 'circle', diameterMm: 32 },
  'meganob': { type: 'circle', diameterMm: 40 },
  'warboss': { type: 'circle', diameterMm: 40 },
  'gretchin': { type: 'circle', diameterMm: 25 },
  'grot': { type: 'circle', diameterMm: 25 },
  'lootas': { type: 'circle', diameterMm: 32 },
  'burna boy': { type: 'circle', diameterMm: 32 },
  'stormboy': { type: 'circle', diameterMm: 32 },
  'kommando': { type: 'circle', diameterMm: 32 },
  'flash git': { type: 'circle', diameterMm: 32 },
  'deff dread': { type: 'circle', diameterMm: 60 },
  'killa kan': { type: 'circle', diameterMm: 60 },
  'gorkanaut': { type: 'oval', widthMm: 170, heightMm: 109 },
  'morkanaut': { type: 'oval', widthMm: 170, heightMm: 109 },
  'battlewagon': { type: 'rect', widthMm: 150, heightMm: 90 },
  'trukk': { type: 'rect', widthMm: 115, heightMm: 70 },
  'wartrike': { type: 'oval', widthMm: 150, heightMm: 92 },
  'warbiker': { type: 'oval', widthMm: 75, heightMm: 42 },
  'deffkilla wartrike': { type: 'oval', widthMm: 150, heightMm: 92 },

  // --- Necrons ---
  'necron warrior': { type: 'circle', diameterMm: 32 },
  'immortal': { type: 'circle', diameterMm: 32 },
  'lychguard': { type: 'circle', diameterMm: 32 },
  'deathmark': { type: 'circle', diameterMm: 32 },
  'skorpekh destroyer': { type: 'circle', diameterMm: 50 },
  'ophydian destroyer': { type: 'circle', diameterMm: 40 },
  'lokhust destroyer': { type: 'circle', diameterMm: 50 },
  'lokhust heavy destroyer': { type: 'circle', diameterMm: 60 },
  'flayed one': { type: 'circle', diameterMm: 28 },
  'canoptek wraith': { type: 'circle', diameterMm: 50 },
  'canoptek scarab': { type: 'circle', diameterMm: 28 },
  'canoptek spyder': { type: 'circle', diameterMm: 60 },
  'tomb blade': { type: 'oval', widthMm: 75, heightMm: 42 },
  'triarch praetorian': { type: 'circle', diameterMm: 32 },
  'ghost ark': { type: 'rect', widthMm: 145, heightMm: 75 },
  'doomsday ark': { type: 'rect', widthMm: 145, heightMm: 75 },
  'annihilation barge': { type: 'rect', widthMm: 145, heightMm: 75 },
  'catacomb command barge': { type: 'rect', widthMm: 145, heightMm: 75 },
  'monolith': { type: 'rect', widthMm: 135, heightMm: 135 },
  'doomstalker': { type: 'circle', diameterMm: 90 },
  'c\'tan shard': { type: 'circle', diameterMm: 40 },
  'overlord': { type: 'circle', diameterMm: 40 },

  // --- Tyranids ---
  'termagant': { type: 'circle', diameterMm: 25 },
  'hormagaunt': { type: 'circle', diameterMm: 28 },
  'gargoyle': { type: 'circle', diameterMm: 28 },
  'genestealer': { type: 'circle', diameterMm: 28 },
  'warrior': { type: 'circle', diameterMm: 40 },
  'tyranid warrior': { type: 'circle', diameterMm: 40 },
  'lictor': { type: 'circle', diameterMm: 50 },
  'zoanthrope': { type: 'circle', diameterMm: 40 },
  'venomthrope': { type: 'circle', diameterMm: 40 },
  'hive guard': { type: 'circle', diameterMm: 40 },
  'tyrant guard': { type: 'circle', diameterMm: 40 },
  'carnifex': { type: 'oval', widthMm: 105, heightMm: 70 },
  'screamer-killer': { type: 'oval', widthMm: 105, heightMm: 70 },
  'tyrannofex': { type: 'oval', widthMm: 105, heightMm: 70 },
  'tervigon': { type: 'oval', widthMm: 105, heightMm: 70 },
  'hive tyrant': { type: 'circle', diameterMm: 60 },
  'swarmlord': { type: 'circle', diameterMm: 60 },
  'winged hive tyrant': { type: 'circle', diameterMm: 60 },
  'exocrine': { type: 'oval', widthMm: 105, heightMm: 70 },
  'haruspex': { type: 'oval', widthMm: 105, heightMm: 70 },
  'mawloc': { type: 'oval', widthMm: 105, heightMm: 70 },
  'trygon': { type: 'oval', widthMm: 105, heightMm: 70 },
  'tyrannoc': { type: 'oval', widthMm: 105, heightMm: 70 },
  'hierophant': { type: 'oval', widthMm: 170, heightMm: 109 },
  'ripper swarm': { type: 'circle', diameterMm: 40 },

  // --- T'au Empire ---
  'fire warrior': { type: 'circle', diameterMm: 25 },
  'fire warrior breacher': { type: 'circle', diameterMm: 25 },
  'fire warrior strike': { type: 'circle', diameterMm: 25 },
  'pathfinder': { type: 'circle', diameterMm: 25 },
  'kroot carnivore': { type: 'circle', diameterMm: 25 },
  'kroot hound': { type: 'circle', diameterMm: 25 },
  'stealth battlesuit': { type: 'circle', diameterMm: 32 },
  'crisis battlesuit': { type: 'circle', diameterMm: 50 },
  'broadside battlesuit': { type: 'circle', diameterMm: 60 },
  'riptide battlesuit': { type: 'circle', diameterMm: 130 },
  'ghostkeel battlesuit': { type: 'circle', diameterMm: 105 },
  'stormsurge': { type: 'oval', widthMm: 170, heightMm: 109 },
  'hammerhead': { type: 'rect', widthMm: 120, heightMm: 75 },
  'devilfish': { type: 'rect', widthMm: 120, heightMm: 75 },
  'piranha': { type: 'oval', widthMm: 60, heightMm: 35 },

  // --- Aeldari ---
  'guardian': { type: 'circle', diameterMm: 25 },
  'dire avenger': { type: 'circle', diameterMm: 28 },
  'howling banshee': { type: 'circle', diameterMm: 28 },
  'striking scorpion': { type: 'circle', diameterMm: 28 },
  'fire dragon': { type: 'circle', diameterMm: 28 },
  'dark reaper': { type: 'circle', diameterMm: 28 },
  'warp spider': { type: 'circle', diameterMm: 28 },
  'ranger': { type: 'circle', diameterMm: 25 },
  'wraithguard': { type: 'circle', diameterMm: 40 },
  'wraithblade': { type: 'circle', diameterMm: 40 },
  'wraithlord': { type: 'circle', diameterMm: 60 },
  'wraithknight': { type: 'oval', widthMm: 170, heightMm: 109 },
  'war walker': { type: 'circle', diameterMm: 60 },
  'windrider': { type: 'oval', widthMm: 75, heightMm: 42 },
  'shining spear': { type: 'oval', widthMm: 75, heightMm: 42 },
  'wave serpent': { type: 'rect', widthMm: 130, heightMm: 70 },
  'falcon': { type: 'rect', widthMm: 120, heightMm: 70 },
  'fire prism': { type: 'rect', widthMm: 120, heightMm: 70 },
  'night spinner': { type: 'rect', widthMm: 120, heightMm: 70 },
  'avatar of khaine': { type: 'circle', diameterMm: 80 },

  // --- Drukhari ---
  'kabalite warrior': { type: 'circle', diameterMm: 25 },
  'wych': { type: 'circle', diameterMm: 25 },
  'incubi': { type: 'circle', diameterMm: 28 },
  'mandrake': { type: 'circle', diameterMm: 28 },
  'raider': { type: 'rect', widthMm: 130, heightMm: 55 },
  'ravager': { type: 'rect', widthMm: 130, heightMm: 55 },
  'venom': { type: 'oval', widthMm: 75, heightMm: 42 },
  'reaver jetbike': { type: 'oval', widthMm: 75, heightMm: 42 },
  'hellion': { type: 'oval', widthMm: 75, heightMm: 42 },
  'talos': { type: 'circle', diameterMm: 60 },
  'cronos': { type: 'circle', diameterMm: 60 },

  // --- Genestealer Cults ---
  'neophyte hybrid': { type: 'circle', diameterMm: 25 },
  'acolyte hybrid': { type: 'circle', diameterMm: 25 },
  'aberrant': { type: 'circle', diameterMm: 32 },
  'goliath truck': { type: 'rect', widthMm: 115, heightMm: 70 },
  'goliath rockgrinder': { type: 'rect', widthMm: 115, heightMm: 70 },
  'achilles ridgerunner': { type: 'oval', widthMm: 120, heightMm: 92 },

  // --- Leagues of Votann ---
  'hearthkyn warrior': { type: 'circle', diameterMm: 25 },
  'einhyr hearthguard': { type: 'circle', diameterMm: 40 },
  'sagitaur': { type: 'rect', widthMm: 105, heightMm: 65 },
  'hekaton land fortress': { type: 'rect', widthMm: 150, heightMm: 90 },

  // --- Adeptus Mechanicus ---
  'skitarii ranger': { type: 'circle', diameterMm: 25 },
  'skitarii vanguard': { type: 'circle', diameterMm: 25 },
  'sicarian infiltrator': { type: 'circle', diameterMm: 32 },
  'sicarian ruststalker': { type: 'circle', diameterMm: 32 },
  'kataphron breacher': { type: 'circle', diameterMm: 60 },
  'kataphron destroyer': { type: 'circle', diameterMm: 60 },
  'kastelan robot': { type: 'circle', diameterMm: 60 },
  'ironstrider ballistarius': { type: 'oval', widthMm: 105, heightMm: 70 },
  'sydonian dragoon': { type: 'oval', widthMm: 105, heightMm: 70 },
  'onager dunecrawler': { type: 'circle', diameterMm: 130 },
  'skorpius disintegrator': { type: 'rect', widthMm: 130, heightMm: 70 },
  'skorpius dunerider': { type: 'rect', widthMm: 130, heightMm: 70 },

  // --- Adeptus Custodes ---
  'custodian guard': { type: 'circle', diameterMm: 40 },
  'allarus custodian': { type: 'circle', diameterMm: 40 },
  'vertus praetor': { type: 'oval', widthMm: 90, heightMm: 52 },
  'caladius grav-tank': { type: 'rect', widthMm: 130, heightMm: 80 },
  'telemon dreadnought': { type: 'circle', diameterMm: 80 },
  'contemptor-galactus dreadnought': { type: 'circle', diameterMm: 60 },

  // --- Grey Knights ---
  'grey knight': { type: 'circle', diameterMm: 32 },
  'strike squad marine': { type: 'circle', diameterMm: 32 },
  'paladin': { type: 'circle', diameterMm: 40 },
  'grey knight terminator': { type: 'circle', diameterMm: 40 },
  'nemesis dreadknight': { type: 'circle', diameterMm: 80 },
};

/**
 * Look up the base shape for a model by name.
 * Tries exact match (lowercased), then checks if any key is contained in the name
 * or the name is contained in any key.
 */
export function lookupBaseShape(modelName: string): BaseShape | undefined {
  const lower = modelName.toLowerCase().trim();

  // Exact match
  if (BASE_LOOKUP[lower]) return BASE_LOOKUP[lower];

  // Check if model name contains a lookup key (e.g. "Intercessor Sergeant" matches "intercessor")
  // Prefer longer matches to avoid false positives
  let bestMatch: BaseShape | undefined;
  let bestLen = 0;
  for (const [key, shape] of Object.entries(BASE_LOOKUP)) {
    if (lower.includes(key) && key.length > bestLen) {
      bestMatch = shape;
      bestLen = key.length;
    }
  }

  return bestMatch;
}
