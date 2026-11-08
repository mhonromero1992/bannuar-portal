import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate, fmtDateTime } from '../lib/format';
import { COVERAGE, INQUIRY_STATUS, SITE_TYPE, options } from '../lib/labels';
import { Dialog, Empty, ErrorState, Loading, PageHead, SelectField, StatusBadge, TextArea, useToast } from '../ui/kit';

export default function Inquiries() {
  const [filter, setFilter] = useState('active');
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const q = useQuery({
    queryKey: ['inquiries', filter],
    queryFn: async () => {
      let req = supabase.from('inquiries').select('*').order('created_at', { ascending: false }).limit(300);
      if (filter === 'active') req = req.in('status', ['new', 'contacted', 'site_visit', 'proposal_sent']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  return (
    <>
      <PageHead title="Proposal requests" intro="Companies that asked for guards through the website. Call them back and keep the status current." />
      <div className="panel">
        <div className="toolbar">
          <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Open</option>
            {options(INQUIRY_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="">Every request</option>
          </select>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No proposal requests here">Requests sent from the website's proposal page appear here.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Company</th><th>Contact</th><th>Post</th><th className="num">Guards</th><th>Hours</th><th>Sent</th><th>Status</th></tr></thead>
              <tbody>{q.data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                  <td><button className="link-btn cell-main" type="button" onClick={() => setOpen(r)}>{r.company}</button></td>
                  <td>{r.contact_name}<span className="cell-sub tabular">{r.phone}</span></td>
                  <td>{SITE_TYPE[r.site_type] ?? ''}{r.site_address && <span className="cell-sub">{r.site_address}</span>}</td>
                  <td className="num">{r.guards_needed ?? ''}</td>
                  <td>{COVERAGE[r.coverage] ?? ''}</td>
                  <td className="tabular">{fmtDateTime(r.created_at)}</td>
                  <td><StatusBadge map={INQUIRY_STATUS} value={r.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog open={Boolean(open)} title={(open?.company as string) ?? ''} onClose={() => setOpen(null)}>
        {open && <InquiryDetail r={open} onClose={() => setOpen(null)} />}
      </Dialog>
    </>
  );
}

function InquiryDetail({ r, onClose }: { r: Record<string, unknown>; onClose: () => void }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(r.status as string);
  const [notes, setNotes] = useState((r.staff_notes as string) ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('inquiries').update({ status, staff_notes: notes.trim() || null, assigned_to: r.assigned_to ?? session?.user.id }).eq('id', r.id as string);
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['inquiries'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('Saved.');
    onClose();
  };
  const rows: [string, unknown][] = [
    ['Contact', [r.contact_name, r.position].filter(Boolean).join(', ')], ['Phone', r.phone], ['Email', r.email], ['Where', r.site_address],
    ['Kind of site', SITE_TYPE[r.site_type as string]], ['Guards needed', r.guards_needed], ['Hours', COVERAGE[r.coverage as string]],
    ['From', fmtDate(r.start_on as string)], ['Message', r.message], ['Sent', fmtDateTime(r.created_at as string)],
  ];
  return (
    <div className="stack">
      <dl className="dl">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
      <div className="row">{Boolean(r.phone) && <a className="btn btn-line btn-sm" href={`tel:${String(r.phone).replace(/[^\d+]/g, '')}`}>Call</a>}{Boolean(r.email) && <a className="btn btn-line btn-sm" href={`mailto:${r.email}`}>Email</a>}</div>
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={options(INQUIRY_STATUS)} />
      <TextArea label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      <div className="form-foot"><button className="btn" type="button" aria-busy={busy} onClick={save}>Save</button></div>
    </div>
  );
}
