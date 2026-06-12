/**
 * Battlescribe .rosz XML → OpenHammer JSON converter.
 *
 * A .rosz file is a ZIP archive containing a single .ros XML file.
 * This module converts the parsed XML string into a BattlescribeRoster
 * that can be fed to the existing importer pipeline.
 *
 * Usage:
 *   1. Client decompresses the .rosz ZIP (using browser APIs or a ZIP library)
 *   2. Client extracts the .ros XML string
 *   3. Call `convertRoszXml(xmlString)` to get a BattlescribeRoster
 *   4. Pass the roster to `buildArmyUnits()` for import
 */

import type {
  BattlescribeRoster,
  BattlescribeForce,
  BattlescribeSelection,
  BattlescribeProfile,
  BattlescribeCategory,
  BattlescribeRule,
  BattlescribeCost,
  BattlescribeCharacteristic,
} from './schema';

/**
 * Parse a Battlescribe .ros XML string into a BattlescribeRoster JSON object.
 *
 * The XML structure mirrors the JSON structure the importer expects:
 * <roster>
 *   <forces>
 *     <force catalogueName="...">
 *       <selections>
 *         <selection name="..." type="model|unit|upgrade" number="1">
 *           <profiles>...</profiles>
 *           <selections>...</selections> (sub-selections for multi-model units)
 *           <categories>...</categories>
 *           <costs>...</costs>
 *           <rules>...</rules>
 *         </selection>
 *       </selections>
 *     </force>
 *   </forces>
 * </roster>
 *
 * @param xmlString - The raw XML content from the .ros file
 * @param parseXml - A function to parse XML string to a DOM document.
 *                   In browsers, use `(s) => new DOMParser().parseFromString(s, 'text/xml')`.
 *                   In Node/tests, inject an alternative parser.
 */
export function convertRoszXml(
  xmlString: string,
  parseXml: (xml: string) => { querySelector: (sel: string) => unknown; querySelectorAll: (sel: string) => unknown },
): BattlescribeRoster {
  const doc = parseXml(xmlString) as Document;
  const rosterEl = doc.querySelector('roster');
  if (!rosterEl) {
    throw new Error('Invalid .ros XML: no <roster> element found');
  }

  const rosterName = rosterEl.getAttribute('name') ?? undefined;
  const costs = parseCosts(rosterEl);

  const forces: BattlescribeForce[] = [];
  const forceEls = rosterEl.querySelectorAll(':scope > forces > force');
  for (const forceEl of Array.from(forceEls)) {
    forces.push(parseForce(forceEl as Element));
  }

  return {
    roster: {
      name: rosterName,
      costs,
      forces,
    },
  };
}

function parseForce(el: Element): BattlescribeForce {
  const name = el.getAttribute('name') ?? undefined;
  const catalogueName = el.getAttribute('catalogueName') ?? undefined;

  const selections: BattlescribeSelection[] = [];
  const selEls = el.querySelectorAll(':scope > selections > selection');
  for (const selEl of Array.from(selEls)) {
    selections.push(parseSelection(selEl as Element));
  }

  return { name, catalogueName, selections };
}

function parseSelection(el: Element): BattlescribeSelection {
  const name = el.getAttribute('name') ?? '';
  const type = (el.getAttribute('type') ?? 'upgrade') as 'model' | 'unit' | 'upgrade';
  const numberStr = el.getAttribute('number');
  const number = numberStr ? parseInt(numberStr, 10) : undefined;
  const id = el.getAttribute('id') ?? undefined;

  const profiles = parseProfiles(el);
  const categories = parseCategories(el);
  const costs = parseCosts(el);
  const rules = parseRules(el);

  // Recursive sub-selections
  const subSelections: BattlescribeSelection[] = [];
  const subEls = el.querySelectorAll(':scope > selections > selection');
  for (const subEl of Array.from(subEls)) {
    subSelections.push(parseSelection(subEl as Element));
  }

  return {
    id,
    name,
    number,
    type,
    profiles: profiles.length > 0 ? profiles : undefined,
    categories: categories.length > 0 ? categories : undefined,
    costs: costs.length > 0 ? costs : undefined,
    rules: rules.length > 0 ? rules : undefined,
    selections: subSelections.length > 0 ? subSelections : undefined,
  };
}

function parseProfiles(parent: Element): BattlescribeProfile[] {
  const profiles: BattlescribeProfile[] = [];
  const profileEls = parent.querySelectorAll(':scope > profiles > profile');
  for (const el of Array.from(profileEls)) {
    const profileEl = el as Element;
    const name = profileEl.getAttribute('name') ?? '';
    const typeName = profileEl.getAttribute('typeName') ?? '';

    const characteristics: BattlescribeCharacteristic[] = [];
    const charEls = profileEl.querySelectorAll(':scope > characteristics > characteristic');
    for (const charEl of Array.from(charEls)) {
      const c = charEl as Element;
      characteristics.push({
        name: c.getAttribute('name') ?? '',
        '$text': c.textContent?.trim() ?? '',
      });
    }

    profiles.push({ name, typeName, characteristics });
  }
  return profiles;
}

function parseCategories(parent: Element): BattlescribeCategory[] {
  const categories: BattlescribeCategory[] = [];
  const catEls = parent.querySelectorAll(':scope > categories > category');
  for (const el of Array.from(catEls)) {
    const catEl = el as Element;
    categories.push({
      name: catEl.getAttribute('name') ?? '',
      primary: catEl.getAttribute('primary') === 'true',
    });
  }
  return categories;
}

function parseCosts(parent: Element): BattlescribeCost[] {
  const costs: BattlescribeCost[] = [];
  const costEls = parent.querySelectorAll(':scope > costs > cost');
  for (const el of Array.from(costEls)) {
    const costEl = el as Element;
    const name = costEl.getAttribute('name') ?? '';
    const valueStr = costEl.getAttribute('value') ?? '0';
    costs.push({ name, value: parseFloat(valueStr) });
  }
  return costs;
}

function parseRules(parent: Element): BattlescribeRule[] {
  const rules: BattlescribeRule[] = [];
  const ruleEls = parent.querySelectorAll(':scope > rules > rule');
  for (const el of Array.from(ruleEls)) {
    const ruleEl = el as Element;
    const name = ruleEl.getAttribute('name') ?? '';
    const descEl = ruleEl.querySelector(':scope > description');
    const description = descEl?.textContent?.trim() ?? '';
    rules.push({ name, description });
  }
  return rules;
}
