/**
 * The showcase video, beat by beat. Paced to be easy to follow: one idea a screen, held long enough to
 * read, a slow zoom to the part that matters, and a tap only after it is explained.
 *
 * A beat: { shot, hold (seconds), zoom (a mark of the shot, several, or {x,y,w,h} in CSS px), ring (a
 * mark to circle), tap (a mark to press at the end), transition ('fade' | 'push' | 'pop' | 'tab' |
 * 'none' for the same screen), url (browser), title + body (a new caption; leave out to keep the last),
 * steps: [label, ...] with step: index (a numbered flow) }.
 * Every record on screen is demo data, and every screen is the real software.
 */
const PORTAL = 'bannuar-portal.vercel.app';
const SITE = 'bannuar-website.vercel.app';
const TIME_IN = ['Check the location', 'Take a photo', 'Logged'];

export const STORYBOARD = [
  { type: 'intro', hold: 9 },

  // ------------------------------------------------------------------ 1. the website
  { type: 'chapter', chapter: 'website', n: 1, title: 'The website', line: 'Where guards apply and companies ask for guards', hold: 5 },
  {
    type: 'screens', device: 'browser', chapter: 'website', host: SITE, kicker: 'Website',
    beats: [
      { shot: 'web-hero', hold: 8, drift: true, url: '/', title: 'Bannuar on the web', body: 'A town kept watch through the night until sunrise: a scene that moves as you scroll.' },
      { shot: 'web-companies', hold: 8, drift: true, url: '/#companies', title: 'Guards for every shift', body: 'Companies see day, night and round-the-clock cover, then ask for a proposal.' },
      { shot: 'web-openings', hold: 8, zoom: ['opening0', 'opening1'], tap: 'pick', url: '/careers/', title: 'Open posts, from the portal', body: 'HR lists a job in the portal and it shows here. Applicants pick the post.' },
      { shot: 'web-applied', hold: 7, zoom: 'done', url: '/careers/', title: 'Straight to HR', body: 'The application, with the resume, waits in the portal under Recruitment.' },
      { shot: 'web-proposal', hold: 7, zoom: { x: 100, y: 0, w: 1240, h: 660 }, ring: 'send', url: '/proposal/', title: 'Ask for a security proposal', body: 'A company says where the post is, how many guards it needs and which hours.' },
      { shot: 'web-proposal', hold: 7, transition: 'none', zoom: { x: 100, y: 300, w: 470, h: 360 }, body: 'The request goes into Bannuar\'s own system, not a mailbox. The office calls back, then sends a proposal.' },
      { shot: 'web-verify', hold: 9, zoom: ['form0', 'result'], url: '/verify/', title: 'Check a certificate', body: 'Banks and employers type the code on a certificate of employment. The site says if it is genuine.' },
    ],
  },

  // ------------------------------------------------------------------ 2. the HR portal
  { type: 'chapter', chapter: 'portal', n: 2, title: 'The HR portal', line: 'For HR, payroll and operations at the office', hold: 5 },
  {
    type: 'screens', device: 'browser', chapter: 'portal', host: PORTAL, kicker: 'HR portal',
    beats: [
      { shot: 'hr-signin', hold: 6, tap: 'signin', url: '/sign-in', title: 'Staff sign in', body: 'Staff join with an invitation code. Each person\'s role decides what they see.' },
      { shot: 'hr-dashboard', hold: 8, zoom: 'panel0', url: '/', title: 'What waits for a decision', body: 'Leave, certificates, contact changes, payroll concerns, applications and proposal requests.' },
      { shot: 'hr-dashboard', hold: 8, zoom: 'tiles0', transition: 'none', title: 'The day at a glance', body: 'Guards on the roll, today\'s time in and out, guards floating near the six-month limit, expired documents.' },
      { shot: 'hr-employees', hold: 7, zoom: { x: 284, y: 181, w: 1124, h: 430 }, url: '/employees', title: 'A 201 file for every guard', body: 'Search by name or number. Filter by status and by post.' },
      { shot: 'hr-employee', hold: 7, zoom: ['head0', 'tabs0', 'panel0'], url: '/employees/e2', title: 'One page for each guard', body: 'Profile, deployment, attendance, documents, government numbers, pay, payslips, leave and certificates.' },
      { shot: 'hr-employee-docs', hold: 9, zoom: 'table0', ring: 'claude', url: '/employees/e2?tab=documents', title: 'Licenses read by Claude', body: 'When a guard sends a photo of a LESP, Claude reads the number, the expiry and the name. HR verifies it.' },
      { shot: 'hr-attendance', hold: 9, zoom: { x: 284, y: 249, w: 1124, h: 380 }, ring: 'away', url: '/attendance', title: 'Time in and out, checked', body: 'Each log has a photo, the server\'s time and the distance from the post. Logs away from the post are flagged.' },
      { shot: 'hr-attendance-log', hold: 7, zoom: 'dialog', title: 'The photo and the place', body: 'Open any log to see the photo and where the phone was.' },
      { shot: 'hr-leave-approve', hold: 7, zoom: 'dialog0', tap: 'save', url: '/requests?tab=leave', title: 'Leave, endorsed then approved', body: 'The commander endorses with a reliever, then HR approves. The guard is told in the app.' },
      { shot: 'hr-coe', hold: 7, zoom: 'table0', ring: 'overdue', tap: 'issue', url: '/requests?tab=coe', title: 'Certificates within three days', body: 'Each request shows its due date, as DOLE requires. A late one is flagged.' },
    ],
  },
  {
    type: 'screens', device: 'paper', chapter: 'portal', kicker: 'HR portal',
    beats: [
      { shot: 'hr-coe-pdf', hold: 9, zoomLate: { x: 0.494, y: 0.768, w: 0.418, h: 0.157 }, title: 'A certificate anyone can check', body: 'Bannuar\'s badge, the signatory, and a code with a QR link to the website\'s check page.' },
    ],
  },
  {
    type: 'screens', device: 'browser', chapter: 'portal', host: PORTAL, kicker: 'HR portal · Payroll',
    beats: [
      { shot: 'hr-pay-rule', hold: 9, zoom: 'table2', ring: 'formula', url: '/settings', title: 'Each client pays its own way', body: 'A pay rule for each client, in formulas payroll can read, like rate × 10% × night hours.' },
      { shot: 'hr-pay-rule-2', hold: 8, zoom: 'example', title: 'Night differential for the last shift', body: 'The guard on the 6 PM shift earns 10% of the hourly rate for 8 hours, as Bannuar pays it.' },
      { shot: 'hr-post-pay', hold: 8, zoom: 'pay', url: '/posts/s1', title: 'An hourly rate for each post', body: 'A rate starts on a date, so a new rate never changes the months before it.' },
      { shot: 'hr-cutoff', hold: 8, zoom: { x: 284, y: 132, w: 1124, h: 400 }, url: '/payroll/p1', title: 'From time in and out to pay', body: 'Clean duties count on their own. Payroll decides the few that need a look.' },
      { shot: 'hr-cutoff-2', hold: 8, zoom: { x: 284, y: 380, w: 1124, h: 270 }, title: 'Clients confirm the duties', body: 'Each client confirms or disputes its posts\' duties within two days. Pay is never held for it.' },
      { shot: 'hr-work-out-pay', hold: 9, zoom: ['tiles2', 'table1'], title: 'Pay worked out for every guard', body: 'Basic pay, overtime and night differential, at each post\'s rate and its client\'s rule.' },
      { shot: 'hr-13th', hold: 10, zoom: 'panel0', ring: 'dante', url: '/payroll/13th-month', title: '13th month, post by post', body: 'Dante moved posts this year: ₱5,200 + ₱10,920 + ₱5,200, each at that post\'s rate, makes ₱21,320.' },
    ],
  },
  {
    type: 'screens', device: 'browser', chapter: 'portal', host: PORTAL, kicker: 'HR portal',
    beats: [
      { shot: 'hr-discipline-code', hold: 8, zoom: ['panel0', 'panel1'], url: '/discipline?tab=code', title: 'A Code of Discipline Claude can read', body: 'Upload the code as a PDF. Claude reads it into rules and penalties; HR approves each rule.' },
      { shot: 'hr-discipline-case', hold: 9, zoom: { x: 260, y: 56, w: 920, h: 620 }, url: '/discipline?tab=cases', title: 'Due process, step by step', body: 'A notice to explain, at least five days to answer, a hearing when asked, then a written decision.' },
      { shot: 'hr-announcements', hold: 7, zoom: 'panel0', url: '/announcements', title: 'Announcements for every post', body: 'Send to everyone, to an area or to chosen posts. See who read and who acknowledged.' },
      { shot: 'hr-recruitment', hold: 7, zoom: 'dialog0', url: '/recruitment', title: 'Applicants from the website', body: 'Open the resume, keep notes, and hire into a 201 file in one step.' },
      { shot: 'hr-users', hold: 7, zoom: ['panel0', 'panel1'], url: '/users', title: 'Each role sees only its part', body: 'HR, payroll, operations and management each have their own access. Staff join by invitation.' },
      { shot: 'hr-audit', hold: 7, zoom: 'panel0', url: '/audit', title: 'Every change on record', body: 'Who changed what, and who opened whose government numbers.' },
    ],
  },

  // ------------------------------------------------------------------ 3. the client portal
  { type: 'chapter', chapter: 'client', n: 3, title: 'The client portal', line: 'For the people at each client company, on a tablet', hold: 5 },
  {
    type: 'screens', device: 'browser', chapter: 'client', host: PORTAL, kicker: 'Client portal',
    beats: [
      { shot: 'hr-client-access', hold: 8, zoom: 'dialog', url: '/posts', title: 'A login for each client', body: 'Operations invites a client\'s people. They see their own posts and nothing else.' },
    ],
  },
  {
    type: 'screens', device: 'tablet', chapter: 'client', clock: '6:25', kicker: 'Client portal',
    beats: [
      { shot: 'client-posts', hold: 9, zoom: 'panel0', ring: 'onduty', title: 'Who is on duty now', body: 'Each post with its guards, and since when each guard has been on duty.' },
      { shot: 'client-attendance', hold: 8, zoom: ['toolbar0', 'panel0'], transition: 'tab', title: 'Time in and out, by day', body: 'When each guard came and left, and if they were at the post. No photos, no locations.' },
      { shot: 'client-cutoff', hold: 8, zoom: 'panel0', tap: 'dispute', transition: 'tab', title: 'Confirm each cutoff', body: 'The client confirms the duties that were served, or disputes one that was not.' },
      { shot: 'client-cutoff-disputed', hold: 7, zoom: 'panel0', tap: 'send', transition: 'fade', body: 'No answer in two days counts as confirmed. Bannuar looks into every dispute.' },
      { shot: 'client-reports', hold: 8, ring: 'panel0', transition: 'tab', title: 'Report an incident', body: 'About a guard or the post. The client sees Bannuar\'s status and update.' },
      { shot: 'client-requests', hold: 8, ring: 'panel0', transition: 'tab', title: 'Ask for more guards', body: 'Or a replacement, or a change of schedule. Operations answers here.' },
    ],
  },

  // ------------------------------------------------------------------ 4. the employee app
  { type: 'chapter', chapter: 'app', n: 4, title: 'The employee app', line: 'On every guard\'s phone', hold: 5 },
  {
    type: 'screens', device: 'phone', chapter: 'app', clock: '5:52', kicker: 'Employee app',
    beats: [
      { shot: 'app-signin-filled', hold: 7, tap: 'signin', title: 'Sign in with the employee number', body: 'The first time, a guard activates with the birthdate and mobile number on file.' },
      { shot: 'app-home', hold: 8, tap: 'timein', title: 'Today at a glance', body: 'Time in, the post, notices from HR, announcements and the latest payslip.' },
      { shot: 'app-timein-locating', hold: 4, transition: 'push', title: 'Time in at the post', body: 'First, the phone finds where it is.', steps: TIME_IN, step: 0 },
      { shot: 'app-timein-located', hold: 7, transition: 'fade', ring: 'atpost', tap: 'photo', body: 'At the post: about 42 m from the Main Gate. Away from it, the guard can still log, and HR sees why.', steps: TIME_IN, step: 1 },
      { shot: 'app-timein-photo', hold: 6, transition: 'fade', tap: 'log', body: 'Then a photo, taken now, at the post.', steps: TIME_IN, step: 2 },
      { shot: 'app-timein-logged', hold: 6, transition: 'fade', tap: 'done', body: 'Logged at 5:52 PM by the server\'s clock, not the phone\'s.', steps: TIME_IN, step: 3 },
    ],
  },
  { type: 'connect', chapter: 'app', hold: 11, kicker: 'One system', title: 'One time in, seen in three places', body: 'Bea\'s phone, HR\'s attendance list and the client\'s tablet show the same 5:52 PM.' },
  {
    type: 'screens', device: 'phone', chapter: 'app', clock: '5:53', kicker: 'Employee app',
    beats: [
      { shot: 'app-home-more', hold: 7, ring: 'show', tap: 'show', title: 'Pay stays private', body: 'Amounts are hidden until the guard taps. Screenshots are blocked on payslips.' },
      { shot: 'app-home-pay', hold: 6, transition: 'none', ring: 'net', tap: 'open' },
      { shot: 'app-payslip', hold: 8, transition: 'push', title: 'Every peso explained', body: 'Basic pay, overtime, night differential and every deduction. Download the PDF or report a concern.' },
      { shot: 'app-leave', hold: 7, transition: 'tab', tap: 'file', title: 'Leave from the phone', body: 'Credits left this year. A request goes to the commander, then to HR.' },
      { shot: 'app-leave-form', hold: 7, transition: 'push', tap: 'submit', body: 'The kind of leave, the dates and a reason, with a document when needed.' },
      { shot: 'app-leave-filed', hold: 7, transition: 'pop', ring: 'request', title: 'Every request, followed', body: 'With the commander, with HR, approved: the guard always knows where it is.' },
      { shot: 'app-coe', hold: 7, transition: 'push', ring: 'request', title: 'Certificates of employment', body: 'Request one for a loan or a new job. HR issues it within three days.' },
      { shot: 'app-cert', hold: 8, transition: 'push', ring: 'code', title: 'The certificate in the phone', body: 'Open the PDF, or show the code. Anyone can check it on the website.' },
      { shot: 'app-announcement', hold: 7, transition: 'push', tap: 'ack', title: 'Announcements to acknowledge', body: 'Read it, then tap I acknowledge. HR sees who has.' },
      { shot: 'app-documents', hold: 7, transition: 'push', ring: 'lesp', tap: 'upload', title: 'Renew a license from the phone', body: 'The license expires in 18 days. The guard uploads the new one.' },
      { shot: 'app-upload-reading', hold: 4, transition: 'push', body: 'A photo of the new LESP, and Claude starts reading it.' },
      { shot: 'app-upload-checked', hold: 8, transition: 'fade', title: 'Claude reads the license', body: 'The number, the expiry and the name, checked against the guard. HR still verifies it.' },
      { shot: 'app-notice', hold: 8, transition: 'push', ring: 'by', title: 'Notices from HR, with due process', body: 'The rule, what happened and the deadline. The guard answers in the app or on paper.' },
      { shot: 'app-notifications', hold: 7, transition: 'push', title: 'Nothing missed', body: 'Payslips, announcements, licenses about to expire and certificates ready.' },
    ],
  },
  {
    type: 'screens', device: 'phone', chapter: 'app', clock: '9:10', kicker: 'Employee app',
    beats: [
      { shot: 'app-home-dark', hold: 7, title: 'Easy on the eyes at night', body: 'Dark mode follows the phone, for the guards on the night shift.' },
    ],
  },
  {
    type: 'screens', device: 'phone', chapter: 'app', clock: '6:20', kicker: 'Employee app · Detachment commanders',
    beats: [
      { shot: 'cmd-home', hold: 7, tap: 'mypost', title: 'For detachment commanders', body: 'My post: their guards, and the leave that waits for them.' },
      { shot: 'cmd-mypost', hold: 7, transition: 'push', tap: 'leave', body: 'Ana Reyes asks for two days off.' },
      { shot: 'cmd-endorse', hold: 8, transition: 'push', tap: 'endorse', title: 'Endorse with a reliever', body: 'The commander picks who covers the post. The leave goes on to HR.' },
      { shot: 'cmd-endorsed', hold: 6, transition: 'pop', tap: 'guard', body: 'Endorsed to HR. Next: Carlo Diaz came without his phone.' },
      { shot: 'cmd-guard', hold: 7, transition: 'push', tap: 'log', title: 'A guard without a phone', body: 'The commander logs the time in for them, with the guard\'s photo. The guard is told.' },
      { shot: 'cmd-log-for', hold: 7, transition: 'push', tap: 'log' },
      { shot: 'cmd-incident', hold: 8, transition: 'push', title: 'Report an incident from the post', body: 'Straight to HR, with the time and the guard involved.' },
    ],
  },
  { type: 'outro', hold: 11 },
];
