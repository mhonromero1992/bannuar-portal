import { useState } from 'react';
import { Link } from 'react-router';
import { supabase } from '../lib/supabase';
import { isS3Key, signFiles } from '../lib/files';
import { fmtDateTime, fullName } from '../lib/format';
import { ATTENDANCE_KIND, LOCATION_CHECK } from '../lib/labels';
import { locationLine, mapsLink, needsALook, type AttendanceLog } from '../lib/attendance';
import { Badge, Dialog, StatusBadge } from '../ui/kit';

/**
 * Links to the selfies of a page of logs: S3 ones (five minutes) from the files function, older ones
 * (ten minutes) from Supabase Storage, one request each. A failure only hides the photos.
 */
export async function selfieLinks(rows: { photo_path: string }[]): Promise<Record<string, string>> {
  const paths = rows.map((r) => r.photo_path);
  const legacy = paths.filter((p) => !isS3Key(p));
  const [s3, old] = await Promise.all([
    signFiles(paths).catch(() => ({})),
    legacy.length
      ? supabase.storage.from('attendance-photos').createSignedUrls(legacy, 600).then(({ data }) => data ?? []).catch(() => [])
      : Promise.resolve([]),
  ]);
  const links: Record<string, string> = { ...s3 };
  for (const d of old as { path: string | null; signedUrl: string }[]) if (d.path && d.signedUrl) links[d.path] = d.signedUrl;
  return links;
}

/** Time in and out logs with their selfies; the employee column is left out on an employee's own page. */
export function AttendanceTable({ rows, photos, showEmployee = true }: { rows: AttendanceLog[]; photos: Record<string, string>; showEmployee?: boolean }) {
  const [open, setOpen] = useState<AttendanceLog | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Photo</th><th>When</th>{showEmployee && <th>Employee</th>}<th>Post</th><th>Location</th></tr></thead>
          <tbody>{rows.map((r) => {
            const who = r.employee ? fullName(r.employee) : 'Employee';
            const url = photos[r.photo_path];
            return (
              <tr key={r.id}>
                <td style={{ width: 64 }}>
                  <button className="thumb" type="button" onClick={() => setOpen(r)} aria-label={`Open the photo and details: ${who}, ${ATTENDANCE_KIND[r.kind].toLowerCase()} ${fmtDateTime(r.logged_at)}`}>
                    {url ? <img src={url} alt="" loading="lazy" /> : <span aria-hidden="true">Photo</span>}
                  </button>
                </td>
                <td><b>{ATTENDANCE_KIND[r.kind]}</b><span className="cell-sub tabular">{fmtDateTime(r.logged_at)}</span></td>
                {showEmployee && <td>{r.employee ? <><Link className="cell-main" to={`/employees/${r.employee.id}?tab=attendance`}>{who}</Link><span className="cell-sub tabular">{r.employee.employee_no}</span></> : <span className="muted">Removed</span>}</td>}
                <td>{r.site ? <Link to={`/posts/${r.site.id}`}>{r.site.name}</Link> : <span className="muted">None</span>}</td>
                <td>
                  <span className="row"><StatusBadge map={LOCATION_CHECK} value={r.location_check} />{r.mock_location && <Badge tone="bad">Mock location app</Badge>}</span>
                  <span className="cell-sub">{locationLine(r)}</span>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <Dialog open={open !== null} title={open ? `${ATTENDANCE_KIND[open.kind]}: ${open.employee ? fullName(open.employee) : 'Employee'}` : ''} onClose={() => setOpen(null)}>
        {open && <LogDetails r={open} url={photos[open.photo_path]} />}
      </Dialog>
    </>
  );
}

function LogDetails({ r, url }: { r: AttendanceLog; url?: string }) {
  return (
    <div className="stack">
      {url ? <img className="photo-large" src={url} alt={`Photo taken at ${ATTENDANCE_KIND[r.kind].toLowerCase()}`} /> : <p className="muted">The photo could not be loaded. Close this and open it again.</p>}
      <dl className="dl">
        <dt>When</dt><dd className="tabular">{fmtDateTime(r.logged_at)} (the database's clock)</dd>
        <dt>Post</dt><dd>{r.site?.name ?? 'None'}</dd>
        <dt>Location</dt>
        <dd>
          <span className="row"><StatusBadge map={LOCATION_CHECK} value={r.location_check} />{r.mock_location && <Badge tone="bad">Mock location app</Badge>}</span>
          <span className="cell-sub">{locationLine(r)}{r.radius_m ? `; the post allows ${r.radius_m} m` : ''}</span>
        </dd>
        {r.latitude !== null && r.longitude !== null && (
          <><dt>Phone's position</dt><dd className="tabular">{r.latitude}, {r.longitude} · <a href={mapsLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer">Open in Google Maps</a></dd></>
        )}
      </dl>
      {needsALook(r) && (
        <p className="callout warn">
          {r.mock_location
            ? 'The phone had a mock location app on, so the location may be made up. Check the photo and ask the commander.'
            : 'GPS can be off indoors or between tall buildings. Check the photo, and ask the commander if it is unclear.'}
        </p>
      )}
    </div>
  );
}
