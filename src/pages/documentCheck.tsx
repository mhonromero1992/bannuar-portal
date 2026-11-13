import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { post, isS3Key } from '../lib/files';
import { errorText, fmtDate } from '../lib/format';
import { Badge, useToast } from '../ui/kit';

/**
 * What Claude read on an uploaded document (the document-ai function, schema.sql section 18): kept with
 * the file in stored_files.ai_check. HR reads it beside the document while reviewing; it is a help, not
 * a verification.
 */
export interface DocCheck {
  status: 'checked'; type_ok: boolean; legibility: 'clear' | 'partly_readable' | 'unreadable'; holder_name: string;
  name_match: 'match' | 'partial' | 'mismatch' | 'unknown'; document_no: string; issued_on: string; expires_on: string;
  expiry: 'expired' | 'expiring' | 'valid' | 'unknown' | 'none'; issuer: string; concerns: string[]; model?: string; checked_at?: string;
}

/** The checks of these files, by key (staff read stored_files). */
export function useDocChecks(keys: string[]) {
  const s3 = keys.filter(isS3Key);
  return useQuery({
    queryKey: ['doc-checks', s3.join(',')],
    enabled: s3.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('stored_files').select('object_key,ai_check').in('object_key', s3);
      if (error) throw error;
      return Object.fromEntries((data ?? []).filter((r) => r.ai_check).map((r) => [r.object_key as string, r.ai_check as DocCheck]));
    },
  });
}

const EXPIRY: Record<DocCheck['expiry'], [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  valid: ['valid', 'ok'], expiring: ['expires soon', 'warn'], expired: ['expired', 'bad'], unknown: ['expiry not readable', 'warn'], none: ['no expiry', 'neutral'],
};
const NAME: Record<DocCheck['name_match'], [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  match: ['name matches', 'ok'], partial: ['name partly matches', 'warn'], mismatch: ['name does not match', 'bad'], unknown: ['name not readable', 'warn'],
};

/** One line under the document: what Claude read, and what HR should look at. */
export function DocCheckLine({ c, recorded }: { c: DocCheck; recorded: { document_no: string | null; expires_on: string | null } }) {
  const differs = (c.document_no && recorded.document_no && c.document_no.replace(/\s/g, '') !== recorded.document_no.replace(/\s/g, ''))
    || (c.expires_on && recorded.expires_on && c.expires_on !== recorded.expires_on);
  return (
    <span className="cell-sub" aria-label="Claude's reading">
      <span className="row">
        <b className="small">Claude read:</b>
        {!c.type_ok && <Badge tone="bad">not this kind of document</Badge>}
        <Badge tone={EXPIRY[c.expiry][1]}>{EXPIRY[c.expiry][0]}{c.expires_on ? ` (${fmtDate(c.expires_on)})` : ''}</Badge>
        <Badge tone={NAME[c.name_match][1]}>{NAME[c.name_match][0]}</Badge>
        {c.legibility !== 'clear' && <Badge tone="warn">{c.legibility === 'unreadable' ? 'unreadable' : 'partly readable'}</Badge>}
        {differs && <Badge tone="warn">differs from what was entered</Badge>}
      </span>
      {(c.document_no || c.holder_name) && <span className="small">{[c.document_no && `No. ${c.document_no}`, c.holder_name && `name on it: ${c.holder_name}`].filter(Boolean).join(' · ')}</span>}
      {c.concerns.length > 0 && <span className="small">{c.concerns.join(' ')}</span>}
    </span>
  );
}

/** HR asks Claude to read a document now (one uploaded before the check, or by HR). */
export function AskClaude({ fileKey }: { fileKey: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const res = (await (await post('document-ai', JSON.stringify({ action: 'check', key: fileKey }))).json()) as { status: string; message?: string };
      if (res.status !== 'checked') toast(res.message ?? 'Claude could not read it.', 'error');
      qc.invalidateQueries({ queryKey: ['doc-checks'] });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return <button className="link-btn small" type="button" onClick={go} aria-busy={busy}>{busy ? 'Claude is reading…' : 'Have Claude read it'}</button>;
}
