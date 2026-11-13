export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
type Map = Record<string, [string, Tone]>;

export const EMPLOYEE_STATUS: Map = {
  active: ['Active', 'ok'],
  floating: ['Floating', 'warn'],
  on_leave: ['On leave', 'info'],
  suspended: ['Suspended', 'bad'],
  awol: ['AWOL', 'bad'],
  resigned: ['Resigned', 'neutral'],
  terminated: ['Terminated', 'neutral'],
  end_of_contract: ['End of contract', 'neutral'],
  retired: ['Retired', 'neutral'],
};
export const EMPLOYMENT_TYPE: Record<string, string> = { probationary: 'Probationary', regular: 'Regular', contractual: 'Contractual', project: 'Project' };
export const LEAVE_STATUS: Map = {
  pending_supervisor: ['With the commander', 'warn'],
  pending_hr: ['With HR', 'warn'],
  approved: ['Approved', 'ok'],
  rejected: ['Not approved', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
};
export const COE_STATUS: Map = { pending: ['Pending', 'warn'], issued: ['Issued', 'ok'], rejected: ['Declined', 'bad'], cancelled: ['Cancelled', 'neutral'] };
export const COE_PURPOSE: Record<string, string> = {
  employment: 'New employment', bank_loan: 'Bank or loan', government: 'Government requirement',
  travel_visa: 'Travel or visa', school: 'School', other: 'Other',
};
export const REQUEST_STATUS: Map = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'bad'], cancelled: ['Cancelled', 'neutral'] };
export const CONCERN_STATUS: Map = { open: ['Open', 'warn'], in_review: ['In review', 'info'], resolved: ['Resolved', 'ok'], closed: ['Closed', 'neutral'] };
export const CONCERN_CATEGORY: Record<string, string> = {
  missing_pay: 'Missing pay', overtime: 'Overtime', night_differential: 'Night differential', holiday_pay: 'Holiday pay',
  deduction: 'Deduction', contribution: 'Contribution', tax: 'Tax', other: 'Other',
};
export const ATTENDANCE_KIND: Record<string, string> = { time_in: 'Time in', time_out: 'Time out' };
export const ATTENDANCE_SOURCE: Map = { self: ['Own phone', 'neutral'], commander: ['By the commander', 'info'], manual: ['By hand', 'warn'] };
/** log_attendance's check of the phone's location against the post (schema.sql explains each). */
export const LOCATION_CHECK: Map = {
  at_post: ['At the post', 'ok'],
  unsure: ['GPS too rough to tell', 'warn'],
  away: ['Away from the post', 'bad'],
  no_location: ['No location', 'warn'],
  post_not_set: ['Post location not set', 'neutral'],
  no_post: ['No post assigned', 'neutral'],
  manual: ['Entered by hand', 'info'],
};
export const DOC_STATUS: Map = { pending_review: ['To review', 'warn'], verified: ['Verified', 'ok'], rejected: ['Rejected', 'bad'] };
export const PERIOD_STATUS: Map = { draft: ['Draft', 'warn'], published: ['Published', 'ok'] };
export const ANN_STATUS: Map = { draft: ['Draft', 'warn'], published: ['Published', 'ok'], archived: ['Archived', 'neutral'] };
export const ANN_PRIORITY: Map = { normal: ['Normal', 'neutral'], important: ['Important', 'info'], urgent: ['Urgent', 'bad'] };
export const ANN_CATEGORY: Record<string, string> = { memo: 'Memo', advisory: 'Advisory', policy: 'Policy', payroll: 'Payroll', event: 'Event', emergency: 'Emergency' };
export const JOB_STATUS: Map = { draft: ['Draft', 'warn'], open: ['Open', 'ok'], closed: ['Closed', 'neutral'] };
export const APP_STATUS: Map = {
  new: ['New', 'info'], screening: ['Screening', 'warn'], interview: ['Interview', 'warn'], requirements: ['Requirements', 'warn'],
  hired: ['Hired', 'ok'], not_qualified: ['Not qualified', 'neutral'], withdrawn: ['Withdrawn', 'neutral'],
};
export const INQUIRY_STATUS: Map = {
  new: ['New', 'info'], contacted: ['Contacted', 'warn'], site_visit: ['Site visit', 'warn'], proposal_sent: ['Proposal sent', 'warn'],
  won: ['Won', 'ok'], lost: ['Lost', 'neutral'], closed: ['Closed', 'neutral'],
};
export const COVERAGE: Record<string, string> = { day: 'Daytime', night: 'Night', '24h': 'Round the clock', event: 'One event' };
export const SITE_TYPE: Record<string, string> = {
  office: 'Office or bank', commercial: 'Store, mall or restaurant', industrial: 'Factory or warehouse', residential: 'Subdivision or condo',
  school: 'School', hospital: 'Hospital or clinic', government: 'Government office', event: 'Event', other: 'Other',
};
export const EDUCATION: Record<string, string> = {
  high_school: 'High school', senior_high: 'Senior high school', vocational: 'Vocational', college_level: 'Some college', college_graduate: 'College graduate',
};
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin', hr_admin: 'HR admin', hr_staff: 'HR staff', payroll: 'Payroll', operations: 'Operations',
  management: 'Management', supervisor: 'Commander or inspector', employee: 'Employee',
};
export const ROLE_HINT: Record<string, string> = {
  super_admin: 'Everything, including users and roles',
  hr_admin: 'All HR and payroll work, final leave approval, audit log',
  hr_staff: '201 files, documents, leave and COE, recruitment, announcements',
  payroll: 'Cutoffs, payslip import and publishing, pay rates, payroll concerns',
  operations: 'Posts, clients, deployment, announcements, proposal requests',
  management: 'Read-only dashboard and lists',
  supervisor: 'Detachment commanders and inspectors (in the app)',
};

export const label = (m: Map, v?: string | null) => (v && m[v] ? m[v][0] : v ?? '');
export const tone = (m: Map, v?: string | null): Tone => (v && m[v] ? m[v][1] : 'neutral');
export const options = (m: Map | Record<string, string>) =>
  Object.entries(m).map(([value, v]) => ({ value, label: Array.isArray(v) ? v[0] : v }));
