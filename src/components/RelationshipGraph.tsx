'use client';

/**
 * Lightweight SVG relationship graph. No external deps; layout is a
 * deterministic circular arrangement with edge curves so the graph stays
 * readable even on small screens. Polarity colours edges (mint = friendly,
 * coral = hostile, ink = neutral). Strength sets edge thickness.
 *
 * For real force-directed layouts we'd need ~50KB of d3-force or similar;
 * not worth it for the typical 6-12 character cast we ship today.
 */

import { useMemo, useState } from 'react';
import type { Character, Relationship } from '@/lib/types';
import { speakerColor } from './NarrativeFeed';

interface Props {
  characters: Character[];
  /** Optional Phase 2 derived table; when present, polarity/strength
   *  drive edge styling. */
  relationships?: Relationship[];
  /** Highlight a specific character (e.g. the player). */
  focusedId?: string;
}

const SIZE = 480;
const PADDING = 56;
const NODE_R = 22;

export function RelationshipGraph({ characters, relationships, focusedId }: Props) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE / 2 - PADDING;
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Deterministic angular positions
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; angle: number }>();
    const n = characters.length;
    if (n === 0) return map;
    const start = -Math.PI / 2; // top
    characters.forEach((c, i) => {
      const angle = start + (i / n) * Math.PI * 2;
      map.set(c.id, {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        angle,
      });
    });
    return map;
  }, [characters, cx, cy, r]);

  // Build edges: prefer Phase 2 relationships table, else legacy
  // character.relationships embedding. De-dupe undirected pairs.
  const edges = useMemo(() => {
    type Edge = {
      a: string; b: string;
      label: string; polarity?: number; strength?: number;
    };
    const out: Edge[] = [];
    const seen = new Set<string>();
    const pairKey = (x: string, y: string) => x < y ? `${x}|${y}` : `${y}|${x}`;

    if (relationships && relationships.length > 0) {
      for (const r of relationships) {
        const k = pairKey(r.sourceEntityId, r.targetEntityId);
        if (seen.has(k)) continue;
        if (!positions.has(r.sourceEntityId) || !positions.has(r.targetEntityId)) continue;
        seen.add(k);
        out.push({
          a: r.sourceEntityId, b: r.targetEntityId,
          label: r.relationType,
          polarity: r.polarity, strength: r.strength,
        });
      }
    } else {
      for (const c of characters) {
        for (const rel of c.relationships || []) {
          const k = pairKey(c.id, rel.characterId);
          if (seen.has(k)) continue;
          if (!positions.has(rel.characterId)) continue;
          seen.add(k);
          out.push({ a: c.id, b: rel.characterId, label: rel.relation });
        }
      }
    }
    return out;
  }, [relationships, characters, positions]);

  if (characters.length === 0) {
    return <p className="font-mono text-xs text-[var(--ink-muted)]">{'// 暂无角色'}</p>;
  }

  // Edge styling
  const edgeStroke = (polarity?: number) => {
    if (typeof polarity !== 'number') return 'var(--ink)';
    if (polarity > 0.2) return 'var(--hi-mint)';
    if (polarity < -0.2) return 'var(--hi-coral)';
    return 'var(--ink)';
  };
  const edgeWidth = (strength?: number) => {
    const s = typeof strength === 'number' ? strength : 0.5;
    return 1 + s * 2.5;
  };

  return (
    <div className="surface p-3 sm:p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`}
           width="100%"
           style={{ maxWidth: SIZE, display: 'block', margin: '0 auto' }}>
        {/* Edges (drawn first, behind nodes) */}
        <g>
          {edges.map((e, i) => {
            const A = positions.get(e.a)!;
            const B = positions.get(e.b)!;
            // Curve away from centre slightly so overlapping edges separate.
            const mx = (A.x + B.x) / 2;
            const my = (A.y + B.y) / 2;
            const dx = mx - cx;
            const dy = my - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const offset = 18;
            const cpx = mx + (dx / dist) * offset * 0.4;
            const cpy = my + (dy / dist) * offset * 0.4;
            return (
              <g key={i}>
                <path
                  d={`M ${A.x} ${A.y} Q ${cpx} ${cpy} ${B.x} ${B.y}`}
                  stroke={edgeStroke(e.polarity)}
                  strokeWidth={edgeWidth(e.strength)}
                  fill="none"
                  opacity={0.85}
                />
                <title>{e.label}</title>
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {characters.map(c => {
            const pos = positions.get(c.id);
            if (!pos) return null;
            const isFocused = focusedId === c.id;
            const isHovered = hoveredId === c.id;
            // Match the avatar palette (NarrativeFeed.speakerColor).
            const fill = `var(--hi-${speakerColor(c.name)})`;
            return (
              <g
                key={c.id}
                onMouseEnter={() => setHoveredId(c.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ cursor: 'default' }}
              >
                <circle
                  cx={pos.x} cy={pos.y}
                  r={NODE_R}
                  fill={fill}
                  stroke="var(--ink)"
                  strokeWidth={isFocused || isHovered ? 4 : 2.5}
                  style={{
                    filter: (isFocused || isHovered)
                      ? 'drop-shadow(3px 3px 0 var(--ink))'
                      : 'drop-shadow(2px 2px 0 var(--ink))',
                    transition: 'stroke-width 0.12s ease',
                  }}
                />
                <text
                  x={pos.x} y={pos.y + 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="bold"
                  fontFamily="var(--font-sans)"
                  fill="var(--ink)"
                  style={{ pointerEvents: 'none' }}
                >
                  {c.name[0]}
                </text>
                <title>{c.name}</title>
              </g>
            );
          })}
        </g>

        {/* Hover label — drawn last so it sits above all other nodes/edges.
            Positioned just above the focused node with a paper-coloured
            backing rect so it stays legible against the graph. */}
        {hoveredId && (() => {
          const node = positions.get(hoveredId);
          const char = characters.find(c => c.id === hoveredId);
          if (!node || !char) return null;
          const padX = 8;
          // Approximate text width — Chinese chars are ~13px each at 12px font.
          const textWidth = char.name.length * 13 + 4;
          const boxW = textWidth + padX * 2;
          const boxH = 22;
          // Place above the node by default; flip below if too close to top.
          const above = node.y - NODE_R - 14 - boxH > 4;
          const boxX = Math.max(2, Math.min(SIZE - boxW - 2, node.x - boxW / 2));
          const boxY = above ? node.y - NODE_R - 12 - boxH : node.y + NODE_R + 12;
          const textX = boxX + boxW / 2;
          const textY = boxY + boxH / 2 + 4;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={boxX} y={boxY}
                width={boxW} height={boxH}
                fill="var(--paper-raised)"
                stroke="var(--ink)"
                strokeWidth={2}
                style={{ filter: 'drop-shadow(2px 2px 0 var(--ink))' }}
              />
              <text
                x={textX} y={textY}
                textAnchor="middle"
                fontSize="12"
                fontWeight="bold"
                fontFamily="var(--font-sans)"
                fill="var(--ink)"
              >
                {char.name}
              </text>
            </g>
          );
        })()}

      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] font-mono text-[var(--ink-muted)] justify-center">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 18, height: 3, background: 'var(--hi-mint)' }} />
          亲近
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 18, height: 3, background: 'var(--ink)' }} />
          中立 / 未明
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 18, height: 3, background: 'var(--hi-coral)' }} />
          敌对
        </span>
        <span>· 线宽 = 关系强度 · 节点字母 = 姓名首字 · 悬停看全名</span>
      </div>
    </div>
  );
}
