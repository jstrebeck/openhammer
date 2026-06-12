import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import type { Detachment, Stratagem, Enhancement } from '@openhammer/core';
import { getFaction } from '@openhammer/core';

// ─── Enlarged detail card for a single stratagem ───

function StratagemDetailCard({ stratagem }: { stratagem: Stratagem }) {
  return (
    <div className="w-96 bg-gray-950 border border-indigo-500/60 rounded-lg shadow-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-white">{stratagem.name}</div>
        <div className="flex items-center gap-2">
          <span className="text-sm px-2 py-0.5 rounded bg-yellow-700/60 text-yellow-200 font-medium">{stratagem.cpCost} CP</span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
            {stratagem.timing === 'your_turn' ? 'Your Turn' : stratagem.timing === 'opponent_turn' ? "Opponent's Turn" : 'Either Turn'}
          </span>
        </div>
      </div>
      <div className="text-xs text-gray-400">
        Phases: {stratagem.phases.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}
      </div>
      <div className="text-sm text-gray-200 leading-relaxed">{stratagem.description}</div>
      {stratagem.restrictions && stratagem.restrictions.length > 0 && (
        <div className="text-xs text-indigo-300 pt-1 border-t border-gray-700/50">
          Restrictions: {stratagem.restrictions.join(', ')}
        </div>
      )}
    </div>
  );
}

// ─── Enlarged detail card for a single enhancement ───

function EnhancementDetailCard({ enhancement }: { enhancement: Enhancement }) {
  return (
    <div className="w-96 bg-gray-950 border border-green-500/60 rounded-lg shadow-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-white">{enhancement.name}</div>
        <span className="text-sm px-2 py-0.5 rounded bg-green-700/60 text-green-200 font-medium">{enhancement.pointsCost} pts</span>
      </div>
      {enhancement.description && (
        <div className="text-sm text-gray-200 leading-relaxed">{enhancement.description}</div>
      )}
      {enhancement.eligibleKeywords && enhancement.eligibleKeywords.length > 0 && (
        <div className="text-xs text-purple-300 pt-1 border-t border-gray-700/50">
          Eligible: {enhancement.eligibleKeywords.join(', ')}
        </div>
      )}
    </div>
  );
}

// ─── Enlarged detail card for a rule block ───

function RuleDetailCard({ title, description, color }: { title: string; description: string; color: 'yellow' | 'blue' }) {
  const border = color === 'yellow' ? 'border-yellow-500/60' : 'border-blue-500/60';
  const titleColor = color === 'yellow' ? 'text-yellow-300' : 'text-blue-300';
  return (
    <div className={`w-96 bg-gray-950 border ${border} rounded-lg shadow-2xl p-5 space-y-3`}>
      <div className={`text-lg font-bold ${titleColor}`}>{title}</div>
      <div className="text-sm text-gray-200 leading-relaxed">{description}</div>
    </div>
  );
}

// ─── Hover detail state ───

type HoveredItem =
  | { type: 'faction-rule'; title: string; description: string }
  | { type: 'detachment-rule'; title: string; description: string }
  | { type: 'stratagem'; stratagem: Stratagem }
  | { type: 'enhancement'; enhancement: Enhancement };

interface DetachmentTooltipProps {
  detachment: Detachment;
  showFactionRule?: boolean;
}

/**
 * Detailed hover tooltip for a detachment — shows rule, stratagems, and enhancements.
 * Hovering over individual items shows an enlarged detail card to the right.
 */
export function DetachmentTooltip({ detachment, showFactionRule }: DetachmentTooltipProps) {
  const faction = getFaction(detachment.factionId);
  const [hoveredItem, setHoveredItem] = useState<HoveredItem | null>(null);
  const [itemY, setItemY] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleItemEnter = useCallback((item: HoveredItem, e: React.MouseEvent) => {
    if (itemDismissTimer.current) { clearTimeout(itemDismissTimer.current); itemDismissTimer.current = null; }
    const containerRect = containerRef.current?.getBoundingClientRect();
    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredItem(item);
    setItemY(targetRect.top - (containerRect?.top ?? 0));
  }, []);

  const handleItemLeave = useCallback(() => {
    itemDismissTimer.current = setTimeout(() => setHoveredItem(null), 150);
  }, []);

  const handleDetailEnter = useCallback(() => {
    if (itemDismissTimer.current) { clearTimeout(itemDismissTimer.current); itemDismissTimer.current = null; }
  }, []);

  const handleDetailLeave = useCallback(() => {
    itemDismissTimer.current = setTimeout(() => setHoveredItem(null), 150);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="w-80 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 space-y-3 text-xs max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div>
          <div className="text-sm font-medium text-white">{detachment.name}</div>
          {faction && (
            <div className="text-[10px] text-gray-500">{faction.name}</div>
          )}
        </div>

        {/* Faction Rule */}
        {showFactionRule && faction && (
          <div
            className="bg-yellow-900/20 border border-yellow-700/40 rounded p-2 cursor-default hover:border-yellow-500/60 transition-colors"
            onMouseEnter={(e) => handleItemEnter({ type: 'faction-rule', title: `Faction Rule: ${faction.factionRuleName}`, description: faction.factionRuleDescription }, e)}
            onMouseLeave={handleItemLeave}
          >
            <div className="text-[10px] text-yellow-400 font-medium">Faction Rule: {faction.factionRuleName}</div>
            <div className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{faction.factionRuleDescription}</div>
          </div>
        )}

        {/* Detachment Rule */}
        {detachment.rules && (
          <div
            className="bg-blue-900/20 border border-blue-700/40 rounded p-2 cursor-default hover:border-blue-500/60 transition-colors"
            onMouseEnter={(e) => handleItemEnter({ type: 'detachment-rule', title: 'Detachment Rule', description: detachment.rules! }, e)}
            onMouseLeave={handleItemLeave}
          >
            <div className="text-[10px] text-blue-400 font-medium">Detachment Rule</div>
            <div className="text-[10px] text-gray-300 mt-0.5 leading-relaxed line-clamp-2">{detachment.rules}</div>
          </div>
        )}

        {/* Stratagems */}
        {detachment.stratagems && detachment.stratagems.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
              Stratagems ({detachment.stratagems.length})
            </div>
            <div className="space-y-1">
              {detachment.stratagems.map((s) => (
                <div
                  key={s.id}
                  className="bg-gray-800 rounded px-2 py-1.5 cursor-default hover:bg-gray-750 hover:ring-1 hover:ring-indigo-500/40 transition-all"
                  onMouseEnter={(e) => handleItemEnter({ type: 'stratagem', stratagem: s }, e)}
                  onMouseLeave={handleItemLeave}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-200 font-medium">{s.name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] px-1 rounded bg-yellow-700/50 text-yellow-300">{s.cpCost} CP</span>
                      <span className="text-[9px] px-1 rounded bg-gray-700 text-gray-400">
                        {s.timing === 'your_turn' ? 'Your' : s.timing === 'opponent_turn' ? 'Opp.' : 'Either'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-1">{s.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Enhancements */}
        {detachment.enhancements && detachment.enhancements.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
              Enhancements ({detachment.enhancements.length})
            </div>
            <div className="space-y-1">
              {detachment.enhancements.map((e) => (
                <div
                  key={e.id}
                  className="bg-gray-800 rounded px-2 py-1.5 cursor-default hover:bg-gray-750 hover:ring-1 hover:ring-green-500/40 transition-all"
                  onMouseEnter={(ev) => handleItemEnter({ type: 'enhancement', enhancement: e }, ev)}
                  onMouseLeave={handleItemLeave}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-200 font-medium">{e.name}</span>
                    <span className="text-[9px] px-1 rounded bg-green-700/50 text-green-300">{e.pointsCost} pts</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-1">{e.description ?? ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Enlarged detail card — positioned to the right */}
      {hoveredItem && (
        <DetailCardPositioned
          item={hoveredItem}
          y={itemY}
          onMouseEnter={handleDetailEnter}
          onMouseLeave={handleDetailLeave}
        />
      )}
    </div>
  );
}

// ─── Detail card with viewport clamping ───

function DetailCardPositioned({
  item,
  y,
  onMouseEnter,
  onMouseLeave,
}: {
  item: HoveredItem;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [clampedTop, setClampedTop] = useState(y);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    const maxTop = window.innerHeight - rect.height - margin;
    // Compute desired absolute top, then clamp
    const desiredTop = rect.top - (rect.top - y); // starts at y relative to parent
    const overflow = rect.top + rect.height + margin - window.innerHeight;
    if (overflow > 0) {
      setClampedTop(y - overflow);
    } else if (rect.top < margin) {
      setClampedTop(y + (margin - rect.top));
    }
  }, [y, item]);

  let content: React.ReactNode;
  switch (item.type) {
    case 'faction-rule':
      content = <RuleDetailCard title={item.title} description={item.description} color="yellow" />;
      break;
    case 'detachment-rule':
      content = <RuleDetailCard title={item.title} description={item.description} color="blue" />;
      break;
    case 'stratagem':
      content = <StratagemDetailCard stratagem={item.stratagem} />;
      break;
    case 'enhancement':
      content = <EnhancementDetailCard enhancement={item.enhancement} />;
      break;
  }

  return (
    <div
      ref={ref}
      className="absolute left-full top-0 ml-2"
      style={{ top: clampedTop }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {content}
    </div>
  );
}

// ─── Positioned wrapper that clamps itself within the viewport ───

interface PositionedDetachmentTooltipProps {
  detachment: Detachment;
  showFactionRule?: boolean;
  /** Desired x position (left edge) */
  x: number;
  /** Desired y position (top edge) — will be clamped to keep tooltip on screen */
  y: number;
  /** Called when mouse enters the tooltip */
  onMouseEnter?: () => void;
  /** Called when mouse leaves the tooltip */
  onMouseLeave?: () => void;
}

/**
 * Renders DetachmentTooltip in a fixed-position container that automatically
 * adjusts its vertical position so it never overflows the viewport.
 * The tooltip is interactive — users can hover over it to scroll its content.
 */
export function PositionedDetachmentTooltip({ detachment, showFactionRule, x, y, onMouseEnter, onMouseLeave }: PositionedDetachmentTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [clampedY, setClampedY] = useState(y);

  useLayoutEffect(() => {
    if (!ref.current) return;
    // Only measure the first child (the tooltip itself), not the detail card
    const tooltipEl = ref.current.querySelector(':scope > div > div:first-child') as HTMLElement | null;
    const height = tooltipEl?.offsetHeight ?? ref.current.getBoundingClientRect().height;
    const margin = 8;
    const maxY = window.innerHeight - height - margin;
    setClampedY(Math.max(margin, Math.min(y, maxY)));
  }, [y, detachment]);

  return (
    <div
      ref={ref}
      className="fixed z-[60]"
      style={{ left: x, top: clampedY }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <DetachmentTooltip detachment={detachment} showFactionRule={showFactionRule} />
    </div>
  );
}
