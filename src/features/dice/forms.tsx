/** Bottom-sheet forms for recording card events: trades, steals, discards, dev cards, corrections. */
import { useMemo, useState } from 'react';
import { BUILD_LABEL, DEV_KINDS, DEV_LABEL, countTotal, discardCount, type HandEstimate } from '../../model/cards';
import { suggestDiscard, type DiscardAdvice } from '../../model/discard';
import { makePlan } from '../../model/plan';
import { emptyResources, type DevCardKind, type Player, type PlayerId, type Resource, type ResourceCounts } from '../../model/types';
import type { NewCardEvent } from '../../state/slices/dice';
import { useGame } from '../../state/store';
import { tradeRates } from '../../model/suggestionsPlay';
import { PlayerPicker, ResList, ResourceChoice, ResourcePicker, Sheet, icon, nameOf } from './ui';

export type FormKind = 'trade' | 'bank' | 'steal' | 'discard' | 'buyDev' | 'playDev' | 'fixCount';

export const FORM_TITLE: Record<FormKind, string> = {
  trade: 'Trade between players',
  bank: 'Trade with bank or harbor',
  steal: 'Robber steal',
  discard: 'Discard on a 7',
  buyDev: 'Buy a dev card',
  playDev: 'Play a dev card',
  fixCount: 'Correct card count',
};

export interface FormProps {
  kind: FormKind;
  players: Player[];
  est: Record<PlayerId, HandEstimate>;
  /** Pre-selected player (e.g. the current roller). */
  player?: PlayerId;
  onLog: (e: NewCardEvent) => void;
  onClose: () => void;
  /** After a knight, open the steal form for the same player. */
  onKnight?: (player: PlayerId) => void;
}

export function CardForm(props: FormProps) {
  return (
    <Sheet title={FORM_TITLE[props.kind]} onClose={props.onClose}>
      <FormBody {...props} />
    </Sheet>
  );
}

function FormBody({ kind, players, est, player, onLog, onClose, onKnight }: FormProps) {
  const me = players.find((p) => p.isMe)!;
  const [a, setA] = useState<PlayerId>(player ?? me.id);
  const [b, setB] = useState<PlayerId | null>(null);
  const { state } = useGame();
  const advice = useMemo(() => (kind === 'discard' ? suggestDiscard(state, me.id, makePlan(state, me.id).goal) : null), [kind, state, me.id]);
  const [give, setGive] = useState<ResourceCounts>(() => (advice && (player ?? me.id) === me.id ? { ...advice.discard } : emptyResources()));
  const [get, setGet] = useState<ResourceCounts>(emptyResources());
  const [res, setRes] = useState<Resource | null>(null);
  const [dev, setDev] = useState<DevCardKind | null>(null);
  const [taken, setTaken] = useState<Record<PlayerId, number>>({});
  const [res2, setRes2] = useState<Resource | null>(null);
  const [times, setTimes] = useState(1);
  const rates = tradeRates(state, a);
  const [count, setCount] = useState<number>(est[player ?? me.id]?.total ?? 0);

  const isMe = (id: PlayerId | null) => id === me.id;
  const done = (e: NewCardEvent) => {
    onLog(e);
    onClose();
  };
  const who = (
    <PlayerPicker
      players={players}
      value={a}
      onChange={(id) => {
        setA(id);
        setCount(est[id]?.total ?? 0);
        if (kind === 'discard') setGive(id === me.id && advice ? { ...advice.discard } : emptyResources());
      }}
    />
  );

  switch (kind) {
    case 'trade':
      return (
        <div className="form">
          <label>Who offered</label>
          {who}
          <label>Traded with</label>
          <PlayerPicker players={players} value={b} onChange={setB} exclude={[a]} />
          <label>{nameOf(players.find((p) => p.id === a))} gave</label>
          <ResourcePicker value={give} onChange={setGive} />
          <label>…and got</label>
          <ResourcePicker value={get} onChange={setGet} />
          <button className="primary" disabled={!b || (!countTotal(give) && !countTotal(get))} onClick={() => done({ kind: 'trade', player: a, with: b!, give, get })}>
            Save trade
          </button>
        </div>
      );
    case 'bank': {
      const rate = res ? rates[res] : 0;
      const ok = !!res && !!res2 && res !== res2;
      return (
        <div className="form">
          <label>Who traded</label>
          {who}
          <label>Gave</label>
          <ResourceChoice value={res} onChange={setRes} sub={(r) => `${rates[r]}:1`} />
          <label>For</label>
          <ResourceChoice value={res2} onChange={setRes2} />
          <div className="row">
            <span className="grow">Times</span>
            <button className="icon-btn" disabled={times <= 1} onClick={() => setTimes(times - 1)}>
              −
            </button>
            <b className="count">{times}</b>
            <button className="icon-btn" onClick={() => setTimes(times + 1)}>
              +
            </button>
          </div>
          <p className="hint">
            Rates come from the harbors {isMe(a) ? 'your' : 'their'} settlements and cities touch (4:1 without one).
          </p>
          <button
            className="primary"
            disabled={!ok}
            onClick={() => done({ kind: 'trade', player: a, with: 'bank', give: { [res!]: rate * times }, get: { [res2!]: times } })}
          >
            {ok ? `Save: ${rate * times} ${icon(res!)} for ${times} ${icon(res2!)}` : 'Save'}
          </button>
        </div>
      );
    }
    case 'steal': {
      const needRes = isMe(a) || isMe(b);
      return (
        <div className="form">
          <label>Who moved the robber</label>
          {who}
          <label>Stole from</label>
          <PlayerPicker players={players} value={b} onChange={setB} exclude={[a]} />
          <label>Card taken{needRes ? '' : ' (if you saw it)'}</label>
          <ResourceChoice value={res} onChange={(r) => setRes(res === r ? null : r)} />
          {!needRes && <p className="hint">Leave it blank if you didn't see. The app keeps track of every card it could have been.</p>}
          <button
            className="primary"
            disabled={!b || (needRes && !res) || est[b]?.total === 0}
            onClick={() => done({ kind: 'steal', thief: a, victim: b!, resource: res ?? undefined })}
          >
            {b && est[b]?.total === 0 ? 'They have no cards' : 'Save steal'}
          </button>
        </div>
      );
    }
    case 'discard': {
      const need = discardCount(est[a]?.total ?? 0);
      return (
        <div className="form">
          <label>Who discarded</label>
          {who}
          <p className="hint">{need ? `${nameOf(players.find((p) => p.id === a))} should discard ${need} (of ${est[a].total}).` : 'They hold 7 or fewer, so no discard is needed.'}</p>
          {isMe(a) && advice && <p className="hint discard-why">Suggested: drop <ResList res={advice.discard} />. {discardWhy(advice)} Change it below if you like.</p>}
          <ResourcePicker value={give} onChange={setGive} />
          <button className="primary" disabled={!countTotal(give)} onClick={() => done({ kind: 'lose', player: a, resources: give, reason: 'discard' })}>
            Save discard ({countTotal(give)})
          </button>
        </div>
      );
    }
    case 'buyDev':
      return (
        <div className="form">
          <label>Who bought it</label>
          {who}
          {isMe(a) && (
            <>
              <label>Which card did you get?</label>
              <DevChoice value={dev} onChange={setDev} />
            </>
          )}
          <p className="hint">Costs 🐑 🌾 ⛰️.</p>
          <button className="primary" disabled={isMe(a) && !dev} onClick={() => done({ kind: 'build', player: a, item: 'devCard', devCard: isMe(a) ? dev! : undefined })}>
            Save
          </button>
        </div>
      );
    case 'playDev': {
      const others = players.filter((p) => p.id !== a);
      const ok =
        !!dev &&
        (dev !== 'yearOfPlenty' || countTotal(get) === 2) &&
        (dev !== 'monopoly' || !!res);
      return (
        <div className="form">
          <label>Who played it</label>
          {who}
          <DevChoice value={dev} onChange={setDev} exclude={['victoryPoint']} have={isMe(a) ? est[a]?.dev : undefined} />
          {dev === 'yearOfPlenty' && (
            <>
              <label>Took 2 from the bank</label>
              <ResourcePicker value={get} onChange={setGet} max={{ wood: 2, brick: 2, sheep: 2, wheat: 2, ore: 2 }} />
            </>
          )}
          {dev === 'monopoly' && (
            <>
              <label>Named resource</label>
              <ResourceChoice value={res} onChange={setRes} />
              {res && (
                <>
                  <label>How many each player handed over</label>
                  {others.map((p) => (
                    <div key={p.id} className="row">
                      <span className="grow">
                        {nameOf(p)} {icon(res)}
                      </span>
                      <button className="icon-btn" disabled={!taken[p.id]} onClick={() => setTaken({ ...taken, [p.id]: (taken[p.id] ?? 0) - 1 })}>
                        −
                      </button>
                      <b className="count">{taken[p.id] ?? 0}</b>
                      <button className="icon-btn" onClick={() => setTaken({ ...taken, [p.id]: (taken[p.id] ?? 0) + 1 })}>
                        +
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {dev === 'roadBuilding' && <p className="hint">Their next 2 roads on the Pieces tab will be free.</p>}
          {dev === 'knight' && <p className="hint">Next: move the robber on the Pieces tab and record the steal.</p>}
          <button
            className="primary"
            disabled={!ok}
            onClick={() => {
              done({
                kind: 'playDev',
                player: a,
                card: dev!,
                take: dev === 'yearOfPlenty' ? get : undefined,
                resource: dev === 'monopoly' ? res! : undefined,
                taken: dev === 'monopoly' ? taken : undefined,
              });
              if (dev === 'knight') onKnight?.(a);
            }}
          >
            Save
          </button>
        </div>
      );
    }
    case 'fixCount':
      return (
        <div className="form">
          <p className="hint">Count the cards in a player's hand on the table. If it differs, set it here and the app adjusts its guess.</p>
          <PlayerPicker players={players} value={a} onChange={(id) => { setA(id); setCount(est[id]?.total ?? 0); }} exclude={[me.id]} />
          <div className="row">
            <span className="grow">Cards in hand</span>
            <button className="icon-btn" disabled={count <= 0} onClick={() => setCount(count - 1)}>
              −
            </button>
            <b className="count">{count}</b>
            <button className="icon-btn" onClick={() => setCount(count + 1)}>
              +
            </button>
          </div>
          <button className="primary" disabled={isMe(a) || count === est[a]?.total} onClick={() => done({ kind: 'setTotal', player: a, total: count })}>
            Save
          </button>
        </div>
      );
  }
}

function DevChoice({ value, onChange, exclude = [], have }: { value: DevCardKind | null; onChange: (k: DevCardKind) => void; exclude?: DevCardKind[]; have?: Record<DevCardKind, number> }) {
  return (
    <div className="chips">
      {DEV_KINDS.filter((k) => !exclude.includes(k)).map((k) => (
        <button key={k} className={`pchip ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>
          {DEV_LABEL[k]}
          {have ? ` (${have[k]})` : ''}
        </button>
      ))}
    </div>
  );
}


/** One line on why these cards go: what's kept for the goal and what's dropped. */
function discardWhy(a: DiscardAdvice): string {
  const kept = Object.values(a.keptForGoal).some((n) => n > 0);
  const goal = a.goal ? (a.goal.item === 'devCard' ? 'a dev card' : `your ${BUILD_LABEL[a.goal.item].toLowerCase()}`) : null;
  const head = goal && kept ? `It keeps the cards for ${goal} and drops the ones you need least` : 'It drops the cards you need least';
  const fast = a.common.length ? `; you roll ${a.common.map(icon).join('')} most, so ${a.common.length > 1 ? 'they come' : 'it comes'} back fastest` : '';
  return `${head}${fast}.`;
}
