/**
 * Time in and time out. The database writes each log: from the guard's own phone (log_attendance),
 * from the post's commander when the guard has no phone (log_attendance_for: the guard's photo, the
 * commander's location), or by hand by HR with a reason (add_manual_attendance: no photo, no location).
 */

export interface AttendanceLog {
  id: string;
  kind: 'time_in' | 'time_out';
  logged_at: string;
  photo_path: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  radius_m: number | null;
  location_check: string;
  mock_location: boolean | null;
  source: 'self' | 'commander' | 'manual';
  manual_reason: string | null;
  logger: { first_name: string; last_name: string } | null;
  employee: { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null } | null;
  site: { id: string; name: string } | null;
}

export const ATTENDANCE_SELECT =
  'id,kind,logged_at,photo_path,latitude,longitude,accuracy_m,distance_m,radius_m,location_check,mock_location,source,manual_reason,' +
  'employee:employees!attendance_logs_employee_id_fkey(id,employee_no,first_name,middle_name,last_name,suffix),' +
  'logger:employees!attendance_logs_logged_by_employee_id_fkey(first_name,last_name),site:sites(id,name)';

/** Who made the log, for the table: empty for the guard's own phone. */
export function sourceLine(r: Pick<AttendanceLog, 'source' | 'logger'>): string {
  if (r.source === 'commander') return `Logged by ${r.logger ? `${r.logger.first_name} ${r.logger.last_name}` : 'the commander'} (no phone with the guard)`;
  if (r.source === 'manual') return 'Entered by hand by HR';
  return '';
}

/** The logs worth a look: away or unclear, no location, or a mock location app on the phone. */
export const NEEDS_A_LOOK = 'location_check.in.(away,unsure,no_location),mock_location.is.true';

export function needsALook(r: Pick<AttendanceLog, 'location_check' | 'mock_location'>): boolean {
  return ['away', 'unsure', 'no_location'].includes(r.location_check) || r.mock_location === true;
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`;
}

/** One line under the check, for HR: how far, and how sure the phone was. */
export function locationLine(r: AttendanceLog): string {
  const gps = r.accuracy_m !== null ? `GPS accurate to ${fmtDistance(r.accuracy_m)}` : '';
  switch (r.location_check) {
    case 'at_post':
    case 'away':
    case 'unsure':
      return [r.distance_m !== null ? `${fmtDistance(r.distance_m)} from the post` : '', gps].filter(Boolean).join(', ');
    case 'no_location':
      return 'The phone gave no location';
    case 'post_not_set':
      return "The post's location is not set yet";
    case 'no_post':
      return 'Not deployed to a post at the time';
    case 'manual':
      return r.manual_reason ? `Reason: ${r.manual_reason}` : 'No photo or location';
    default:
      return '';
  }
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Day bounds in Manila for a YYYY-MM-DD, as instants for the logged_at filter. */
export function manilaDay(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00+08:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() };
}

/**
 * A post's location as pasted from Google Maps ("14.554729, 121.024445"). Returns the two numbers,
 * or a plain reason. Empty means "no location".
 */
export function parseLocation(text: string): { lat: number; lng: number } | { error: string } | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
  if (!m) return { error: 'Paste the two numbers from Google Maps, like 14.554729, 121.024445.' };
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return lat >= 114 && lat <= 128 && lng >= 4 && lng <= 22
      ? { error: 'The numbers look swapped: put the latitude (about 4 to 21 in the Philippines) first.' }
      : { error: 'Those numbers are not a place on the map. Copy them again from Google Maps.' };
  }
  if (lat < 4 || lat > 22 || lng < 114 || lng > 128) return { error: 'That point is outside the Philippines. Check the numbers.' };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
