/** Small shared pieces for the Dice tab: resource lists, pickers, the bottom sheet. */
import type { ReactNode } from 'react';
import { TERRAIN_STYLE } from '../../components/theme';
import { RESOURCES, type CardEvent, type Player, type PlayerId, type Resource, type ResourceCounts } from '../../model/types';
import { BUILD_LABEL, DEV_LABEL, countTotal } from '../../model/cards';

export const icon = (r: Resource) => TERRAIN_STYLE[r].icon;

/** "🌾2 ⛰️1", or a fallback when empty. */
export function ResList({ res, empty = 'nothing' }: { res: Partial<ResourceCounts> | undefined; empty?: string }) {
  const items = RESOURCES.filter((r) => (res?.[r] ?? 0) > 0);
  if (!items.length) return <span className="muted">{empty}</span>;
  return (
    <span className="res-list">
      {items.map((r) => (
        <span key={r} className="res-pill" style={{ background: TERRAIN_STYLE[r].fill }}>
          {icon(r)} {res![r]}
        </span>
      ))}
    </span>
  );
}

export function Swatch({ p }: { p: Player }) {
  return <span className="swatch small" style={{ background: p.color }} />;
}

export const nameOf = (p: Player | undefined) => (p ? (p.isMe ? 'You' : p.name) : '?');

export function PlayerPicker({ players, value, onChange, exclude }: { players: Player[]; value: PlayerId | null; onChange: (id: PlayerId) => void; exclude?: PlayerId[] }) {
  return (
    <div className="chips">
      {players
        .filter((p) => !exclude?.includes(p.id))
        .map((p) => (
          <button key={p.id} className={`pchip ${value === p.id ? 'on' : ''}`} onClick={() => onChange(p.id)}>
            <Swatch p={p} /> {nameOf(p)}
          </button>
        ))}
    </div>
  );
}

/** Five resources with − / + steppers. */
export function ResourcePicker({ value, onChange, max }: { value: ResourceCounts; onChange: (v: ResourceCounts) => void; max?: Partial<ResourceCounts> }) {
  return (
    <div className="res-picker">
      {RESOURCES.map((r) => (
        <div key={r} className="res-step" style={{ background: TERRAIN_STYLE[r].fill }}>
          <button aria-label={`Add ${r}`} className="plus" disabled={max?.[r] !== undefined && value[r] >= max[r]!} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}>
            {icon(r)}
            <b>{value[r]}</b>
          </button>
          <button aria-label={`Remove ${r}`} className="minus" disabled={!value[r]} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}>
            −
          </button>
        </div>
      ))}
    </div>
  );
}

/** Pick a single resource. */
export function ResourceChoice({ value, onChange, sub }: { value: Resource | null; onChange: (r: Resource) => void; sub?: (r: Resource) => string }) {
  return (
    <div className="grid5">
      {RESOURCES.map((r) => (
        <button key={r} className={`chip ${value === r ? 'on' : ''}`} style={{ background: TERRAIN_STYLE[r].fill }} onClick={() => onChange(r)}>
          <span className="icon">{icon(r)}</span>
          <small>{sub ? sub(r) : TERRAIN_STYLE[r].label}</small>
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One line describing a logged card event. */
export function describeEvent(e: CardEvent, who: (id: PlayerId) => string): ReactNode {
  switch (e.kind) {
    case 'production':
      return (
        <>
          Roll paid{' '}
          {/* Only your pickup (older saves also logged other players'). */}
          {Object.entries(e.gains)
            .filter(([p]) => who(p) === 'You')
            .map(([p, g]) => (
            <span key={p} className="nowrap">
              {who(p)} <ResList res={g} />{' '}
            </span>
          ))}
        </>
      );
    case 'gain':
      return (
        <>
          {who(e.player)} got <ResList res={e.resources} />
        </>
      );
    case 'lose':
      return (
        <>
          {who(e.player)} {e.reason === 'discard' ? 'discarded' : 'lost'} <ResList res={e.resources} />
        </>
      );
    case 'build':
      return (
        <>
          {who(e.player)} {e.item === 'devCard' ? 'bought a dev card' : `built a ${BUILD_LABEL[e.item].toLowerCase()}`}
          {e.devCard ? ` (${DEV_LABEL[e.devCard]})` : ''}
          {e.free ? ' (free)' : ''}
          {e.startGain && countTotal(e.startGain) ? (
            <>
              , starting cards <ResList res={e.startGain} />
            </>
          ) : null}
        </>
      );
    case 'trade':
      return (
        <>
          {who(e.player)} gave <ResList res={e.give} /> to {e.with === 'bank' ? 'the bank' : who(e.with)} for <ResList res={e.get} />
        </>
      );
    case 'steal':
      return (
        <>
          {who(e.thief)} stole {e.resource ? icon(e.resource) : 'a card'} from {who(e.victim)}
        </>
      );
    case 'playDev':
      return (
        <>
          {who(e.player)} played {DEV_LABEL[e.card]}
          {e.take ? (
            <>
              : <ResList res={e.take} />
            </>
          ) : null}
          {e.resource ? `: all ${icon(e.resource)} (${Object.values(e.taken ?? {}).reduce((a, b) => a + b, 0)})` : ''}
        </>
      );
    case 'set':
      return (
        <>
          {who(e.player)} hand set to <ResList res={e.resources} empty="no cards" />
        </>
      );
    case 'setTotal':
      return (
        <>
          {who(e.player)} has {e.total} cards (corrected)
        </>
      );
  }
}
