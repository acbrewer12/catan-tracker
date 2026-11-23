/**
 * Player trades from your side:
 *  - OfferSheet: someone offers you a trade. Enter it, see accept / decline
 *    (with a counter-offer when there's a better one), and record it.
 *  - AskCard: on your turn, the trades the plan says to ask for, each with
 *    "They agreed" (records it, plan updates) and "They said no" (backup plan).
 */
import { useMemo, useState } from 'react';
import { makePlan, type PlanStep } from '../../model/plan';
import { askBackups, judgeOffer, type Backup } from '../../model/tradeOffer';
import { emptyResources, type PlayerId, type Resource, type ResourceCounts } from '../../model/types';
import { useGame } from '../../state/store';
import { PlayerPicker, ResList, ResourcePicker, Sheet, Swatch, icon, nameOf } from '../dice/ui';

const VERDICT = {
  accept: { label: '👍 Accept', cls: 'good' },
  decline: { label: '👎 Decline', cls: 'bad' },
  either: { label: '🤷 Up to you', cls: 'meh' },
  cantAfford: { label: "✋ You can't", cls: 'bad' },
} as const;

export function OfferSheet({ partner: initial, onClose }: { partner?: PlayerId; onClose: () => void }) {
  const { state, dispatch } = useGame();
  const me = state.players.find((p) => p.isMe)!;
  const others = state.players.filter((p) => !p.isMe);
  const [partner, setPartner] = useState<PlayerId>(initial && initial !== me.id ? initial : others[0]?.id);
  const [give, setGive] = useState<ResourceCounts>(emptyResources());
  const [get, setGet] = useState<ResourceCounts>(emptyResources());
  const filled = Object.values(give).some(Boolean) && Object.values(get).some(Boolean);
  const v = useMemo(() => (filled && partner ? judgeOffer(state, me.id, partner, give, get) : null), [state, me.id, partner, give, get, filled]);
  const p = state.players.find((x) => x.id === partner);

  function record() {
    dispatch({ type: 'cards/log', event: { kind: 'trade', player: me.id, with: partner, give, get } });
    onClose();
  }

  return (
    <Sheet title="Trade offered to you" onClose={onClose}>
      <div className="form">
        <label>Who's offering</label>
        <PlayerPicker players={others} value={partner} onChange={setPartner} />
        <label>They want from you</label>
        <ResourcePicker value={give} onChange={setGive} max={state.hands[me.id]?.resources} />
        <label>They give you</label>
        <ResourcePicker value={get} onChange={setGet} />
        {v ? (
          <div className={`verdict ${VERDICT[v.verdict].cls}`}>
            <b>{VERDICT[v.verdict].label}</b>
            {v.reasons.map((r) => (
              <p key={r} className="hint">
                {r}
              </p>
            ))}
            {v.counter && (
              <div className="counter">
                <p className="hint">
                  Counter: give <ResList res={v.counter.give} /> for <ResList res={v.counter.get} />
                </p>
                <button
                  onClick={() => {
                    setGive(v.counter!.give);
                    setGet(v.counter!.get);
                  }}
                >
                  Use counter-offer
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="hint">Fill in both sides to see whether it's a good deal for you.</p>
        )}
        <div className="row">
          <button className="grow" onClick={onClose}>
            Declined
          </button>
          <button className="primary grow" disabled={!filled || v?.verdict === 'cantAfford'} onClick={record}>
            Accepted, record it
          </button>
        </div>
        {p && <p className="hint small">Records you trading with {p.name}; your hand and the plan update right away.</p>}
      </div>
    </Sheet>
  );
}

type Get = Extract<PlanStep, { kind: 'get' }>;

/** The plan's player trades for this turn, with ranked backups when someone says no. */
export function AskCard({ me, declined, onDecline }: { me: PlayerId; declined: Array<{ partner: PlayerId; get: Resource }>; onDecline: (a: { partner: PlayerId; get: Resource }) => void }) {
  const { state, dispatch } = useGame();
  const plan = useMemo(() => makePlan(state, me), [state, me]);
  const gets = plan.steps.filter((s): s is Get => s.kind === 'get');
  const keep: Partial<ResourceCounts> = plan.goal?.cost ?? {};
  const hand = state.hands[me]?.resources ?? emptyResources();
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  // Asks: the plan's first choice for each card, unless that player already said no.
  const rows = gets.flatMap((g) => {
    const o = g.options[0];
    return o?.kind === 'askOther' && !declined.some((d) => d.partner === o.partner && d.get === g.resource) ? [{ partner: o.partner, get: g.resource, give: o.give, why: o.why }] : [];
  });
  const refusedGets = [...new Set(declined.map((d) => d.get))].filter((r) => (keep[r] ?? 0) > hand[r]);
  if (!rows.length && !refusedGets.length) return null;

  function agreed(partner: PlayerId, get: Resource, give: Partial<ResourceCounts>) {
    dispatch({ type: 'cards/log', event: { kind: 'trade', player: me, with: partner, give, get: { [get]: 1 } } });
  }

  return (
    <section className="card asks">
      <span className="label">Ask the table</span>
      {rows.map((a) => (
        <div key={`${a.partner}:${a.get}`} className="ask">
          <p>
            <Swatch p={byId[a.partner]} /> Ask <b>{byId[a.partner]?.name}</b> for {icon(a.get)}, offer <ResList res={a.give} />
          </p>
          <p className="hint small">{a.why}</p>
          <div className="row">
            <button className="grow" onClick={() => onDecline({ partner: a.partner, get: a.get })}>
              They said no
            </button>
            <button className="primary grow" onClick={() => agreed(a.partner, a.get, a.give)}>
              They agreed
            </button>
          </div>
        </div>
      ))}
      {refusedGets.map((get) => (
        <BackupPlan
          key={get}
          get={get}
          refused={declined.filter((d) => d.get === get).map((d) => byId[d.partner]?.name ?? '?')}
          options={askBackups(state, me, get, declined.filter((d) => d.get === get).map((d) => d.partner), keep)}
          onAgreed={(partner, give) => agreed(partner, get, give)}
          onDecline={(partner) => onDecline({ partner, get })}
          onBank={(give, count) => dispatch({ type: 'cards/log', event: { kind: 'trade', player: me, with: 'bank', give: { [give]: count }, get: { [get]: 1 } } })}
        />
      ))}
    </section>
  );
}

function BackupPlan(props: {
  get: Resource;
  refused: string[];
  options: Backup[];
  onAgreed: (p: PlayerId, give: Partial<ResourceCounts>) => void;
  onDecline: (p: PlayerId) => void;
  onBank: (give: Resource, count: number) => void;
}) {
  const { state } = useGame();
  const name = (id: PlayerId) => nameOf(state.players.find((p) => p.id === id));
  return (
    <div className="backup">
      <b>
        {props.refused.join(', ')} said no to {icon(props.get)}. Next best:
      </b>
      <ol className="backup-list">
        {props.options.map((o, i) => (
          <li key={i}>
            {o.kind === 'askOther' ? (
              <div className="row wrap">
                <span className="grow">
                  Ask <b>{name(o.partner)}</b>, offer <ResList res={o.give} />
                </span>
                <button onClick={() => props.onDecline(o.partner)}>No</button>
                <button className="primary" onClick={() => props.onAgreed(o.partner, o.give)}>
                  Agreed
                </button>
              </div>
            ) : o.kind === 'bank' ? (
              <div className="row wrap">
                <span className="grow">
                  Trade {o.count} {icon(o.give)} for {o.count / o.rate} {icon(props.get)} {o.rate === 4 ? 'with the bank' : `at your ${o.rate}:1 harbor`}
                </span>
                <button className="primary" onClick={() => props.onBank(o.give, o.count)}>
                  Do it
                </button>
              </div>
            ) : o.kind === 'switchGoal' ? (
              <span>
                Build {o.goal.item === 'city' ? 'a city' : o.goal.item === 'settlement' ? 'a settlement' : 'a dev card'} instead (see the plan)
              </span>
            ) : (
              <span>Keep your cards and save</span>
            )}
            <p className="hint small">{o.why}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
