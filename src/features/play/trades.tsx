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

type Ask = Extract<PlanStep, { kind: 'ask' }>;

/** The plan's player trades for this turn, with what to do if they say no. */
export function AskCard({ me, declined, onDecline }: { me: PlayerId; declined: Array<{ partner: PlayerId; get: Resource }>; onDecline: (a: { partner: PlayerId; get: Resource }) => void }) {
  const { state, dispatch } = useGame();
  const plan = useMemo(() => makePlan(state, me), [state, me]);
  const asks = plan.steps.filter((s): s is Ask => s.kind === 'ask');
  // Resources asked for that somebody refused, even if the plan now names someone else.
  const keep: Partial<ResourceCounts> = plan.goal?.cost ?? {};
  const hand = state.hands[me]?.resources ?? emptyResources();
  const refusedGets = [...new Set(declined.map((d) => d.get))].filter((r) => (keep[r] ?? 0) > hand[r]);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  if (!asks.length && !refusedGets.length) return null;

  function agreed(partner: PlayerId, get: Resource, give: Resource | null) {
    dispatch({ type: 'cards/log', event: { kind: 'trade', player: me, with: partner, give: give ? { [give]: 1 } : {}, get: { [get]: 1 } } });
  }

  const shown = new Set<string>();
  const rows: Array<{ partner: PlayerId; get: Resource; give: Resource | null; sure?: boolean; theyHave?: number }> = [];
  for (const a of asks) {
    rows.push(a);
    shown.add(`${a.partner}:${a.get}`);
  }
  for (const d of declined) if (!shown.has(`${d.partner}:${d.get}`)) rows.push({ ...d, give: null });

  return (
    <section className="card asks">
      <span className="label">Ask the table</span>
      {rows.map((a) => {
        const no = declined.some((d) => d.partner === a.partner && d.get === a.get);
        return (
          <div key={`${a.partner}:${a.get}`} className={`ask ${no ? 'declined' : ''}`}>
            <p>
              <Swatch p={byId[a.partner]} /> Ask <b>{byId[a.partner]?.name}</b> for {icon(a.get)}
              {a.give ? (
                <>
                  , offer {icon(a.give)}
                </>
              ) : null}
              {a.theyHave !== undefined && <span className="hint small"> ({a.sure ? 'they have one' : `likely ${a.theyHave}`})</span>}
            </p>
            {no ? (
              <p className="hint">✗ They said no.</p>
            ) : (
              <div className="row">
                <button className="grow" onClick={() => onDecline({ partner: a.partner, get: a.get })}>
                  They said no
                </button>
                <button className="primary grow" onClick={() => agreed(a.partner, a.get, a.give)}>
                  They agreed
                </button>
              </div>
            )}
          </div>
        );
      })}
      {refusedGets.map((get) => (
        <BackupPlan
          key={get}
          get={get}
          options={askBackups(state, me, get, declined.filter((d) => d.get === get).map((d) => d.partner), keep)}
          onAgreed={(partner) => agreed(partner, get, null)}
          onDecline={(partner) => onDecline({ partner, get })}
          onBank={(give, count) => dispatch({ type: 'cards/log', event: { kind: 'trade', player: me, with: 'bank', give: { [give]: count }, get: { [get]: 1 } } })}
        />
      ))}
    </section>
  );
}

function BackupPlan(props: { get: Resource; options: Backup[]; onAgreed: (p: PlayerId) => void; onDecline: (p: PlayerId) => void; onBank: (give: Resource, count: number) => void }) {
  const { state } = useGame();
  const name = (id: PlayerId) => nameOf(state.players.find((p) => p.id === id));
  return (
    <div className="backup">
      <b>Backup for {icon(props.get)}:</b>
      {props.options.map((o, i) =>
        o.kind === 'askOther' ? (
          <div key={i} className="row wrap">
            <span className="grow">
              {i === 0 ? 'Try' : 'Or try'} <b>{name(o.partner)}</b> ({o.sure ? 'has one' : `likely ${o.theyHave}`})
            </span>
            <button onClick={() => props.onDecline(o.partner)}>No</button>
            <button className="primary" onClick={() => props.onAgreed(o.partner)}>
              Agreed
            </button>
          </div>
        ) : o.kind === 'bank' ? (
          <div key={i} className="row wrap">
            <span className="grow">
              {props.options.length > 1 ? 'Or trade' : 'Trade'} {o.count} {icon(o.give)} for 1 {icon(props.get)} {o.rate === 4 ? 'with the bank' : `at your ${o.rate}:1 harbor`}
            </span>
            <button className="primary" onClick={() => props.onBank(o.give, o.count)}>
              Do it
            </button>
          </div>
        ) : (
          <p key={i} className="hint">
            Nobody else is likely to have it and you can't trade for it. Hold your cards and keep saving; the plan above shows what you're waiting for.
          </p>
        ),
      )}
    </div>
  );
}
