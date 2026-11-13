import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtDateTime } from '../lib/format';
import { CUTOFF_CLIENT_STATUS, DUTY_FLAG } from '../lib/labels';
import { Badge, ErrorState, Loading, StatusBadge, useToast } from '../ui/kit';

/**
 * A cutoff's time in and out (schema.sql section 19). Clean duties count on their own; payroll decides
 * the exceptions (flagged logs, missing time in or out, and duties a client disputed). Clients confirm
 * their posts' coverage within the time given, or it counts as confirmed: payroll never waits for them.
 */
export interface Exception {
  log_id: string; employee_id: string; employee_no: string; name: string; post: string | null; client: string | null; date: string;
  time_in: string | null; time_out: string | null; hours: number | null; flags: string[]; clean: boolean; client_reason: string | null;
  decision: 'count' | 'not_count' | null; decision_note: string | null; decided_at: string | null;
}
export interface Review {
  period: { id: string; label: string; start: string; end: string; status: string; ended: boolean };
  duties: number; clean: number; counted: number; to_decide: number; disputed: number; exceptions: Exception[];
  clients: { client_id: string; name: string; status: string; due_at: string | null; responded_at: string | null; responder: string | null; note: string | null }[];
}

const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—');

export function useCutoffReview(periodId: string) {
  return useQuery({
    queryKey: ['cutoff-review', periodId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cutoff_review', { p_period_id: periodId });
      if (error) throw error;
      return data as Review;
    },
  });
}

export function CutoffReview({ periodId, draft }: { periodId: string; draft: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useCutoffReview(periodId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cutoff-review', periodId] });
  const decide = async (x: Exception, count: boolean) => {
    const needsNote = !count || Boolean(x.client_reason);
    const note = needsNote
      ? prompt(count ? 'Why does it count although the client disputed it? The client may ask.' : 'Why is it not counted? The guard is told.')
      : '';
    if (note === null) return;
    const { error } = await supabase.rpc('decide_duty', { p_period_id: periodId, p_log_id: x.log_id, p_count: count, p_note: note });
    if (error) return toast(errorText(error), 'error');
    toast(count ? 'Counted.' : 'Not counted. The guard is told.');
    refresh();
  };
  const ask = async () => {
    const { data, error } = await supabase.rpc('open_cutoff_reviews', { p_period_id: periodId, p_days: 2 });
    if (error) return toast(errorText(error), 'error');
    toast(`${data ?? 0} clients asked to confirm within two days.`);
    refresh();
  };
  if (q.isLoading) return <div className="panel"><Loading what="Reading the time in and out" /></div>;
  if (q.error || !q.data) return <div className="panel"><ErrorState error={errorText(q.error)} retry={() => q.refetch()} /></div>;
  const r = q.data;
  const notAsked = r.clients.filter((c) => c.status === 'not_asked').length;
  return (
    <div className="panel" aria-label="Time in and out">
      <div className="panel-head">
        <div>
          <h2>Time in and out</h2>
          <span className="muted small">A time in and its time out make a duty. Clean ones count; you decide the rest. The attendance sheet in Work out pay fills from what counts.</span>
        </div>
      </div>
      <div className="panel-pad stack">
        <div className="tiles">
          <div className="tile"><span className="label">Duties logged</span><span className="big">{r.duties}</span></div>
          <div className="tile"><span className="label">Counted</span><span className="big">{r.counted}</span></div>
          <div className="tile"><span className="label">To decide</span><span className="big">{r.to_decide}</span></div>
          <div className="tile"><span className="label">Disputed by clients</span><span className="big">{r.disputed}</span></div>
        </div>
        <div className="stack">
          <div className="row between">
            <b>Clients</b>
            {draft && (r.period.ended
              ? notAsked > 0 && <button className="btn btn-line btn-sm" type="button" onClick={ask}>Ask {notAsked === 1 ? 'the client' : `${notAsked} clients`} to confirm (2 days)</button>
              : <span className="muted small">Ask clients to confirm once the cutoff has ended.</span>)}
          </div>
          {r.clients.length ? (
            <ul className="client-list">
              {r.clients.map((c) => (
                <li key={c.client_id}>
                  <span><b>{c.name}</b>{c.note && <span className="muted small"> · “{c.note}”</span>}</span>
                  <span className="row">
                    <StatusBadge map={CUTOFF_CLIENT_STATUS} value={c.status} />
                    <span className="muted small">{c.responded_at ? `${c.responder ?? ''} ${fmtDateTime(c.responded_at)}` : c.due_at ? `until ${fmtDateTime(c.due_at)}` : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No client posts had time in or out in this cutoff.</p>}
          <p className="muted small">Clients review coverage only (who, when, how long), never pay. A client who does not answer in time counts as confirmed, and pay goes out on time either way.</p>
        </div>
        {r.exceptions.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Guard</th><th>Duty</th><th>Why it needs you</th><th>Decision</th>{draft && <th />}</tr></thead>
              <tbody>{r.exceptions.map((x) => (
                <tr key={x.log_id}>
                  <td><b>{x.name}</b><span className="cell-sub tabular">{x.employee_no}{x.post ? ` · ${x.post}` : ''}</span></td>
                  <td className="tabular">{fmtDate(x.date)}<span className="cell-sub">{time(x.time_in)} to {time(x.time_out)}{x.hours ? ` · ${x.hours} h` : ''}</span></td>
                  <td>
                    <span className="row">{x.flags.filter((f) => DUTY_FLAG[f]).map((f) => <StatusBadge key={f} map={DUTY_FLAG} value={f} />)}{x.client_reason && <Badge tone="bad">Disputed by {x.client ?? 'the client'}</Badge>}</span>
                    {x.client_reason && <span className="cell-sub">“{x.client_reason}”</span>}
                  </td>
                  <td>
                    {x.decision ? <Badge tone={x.decision === 'count' ? 'ok' : 'bad'}>{x.decision === 'count' ? 'Counted' : 'Not counted'}</Badge>
                      : x.clean ? <Badge tone="ok">Counts unless you decide</Badge> : <Badge tone="warn">To decide</Badge>}
                    {x.decision_note && <span className="cell-sub">{x.decision_note}</span>}
                  </td>
                  {draft && (
                    <td><span className="row">
                      <button className="btn btn-ok btn-sm" type="button" aria-label={`Count ${x.name} on ${fmtDate(x.date)}`} onClick={() => decide(x, true)}>Count</button>
                      <button className="btn btn-line btn-sm" type="button" aria-label={`Do not count ${x.name} on ${fmtDate(x.date)}`} onClick={() => decide(x, false)}>Don't count</button>
                    </span></td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
