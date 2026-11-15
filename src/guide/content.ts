/**
 * The words of the Guide page (pages/Guide.tsx) and the client portal's Help: how to use Bannuar's
 * system, written for the people who use it. No technical detail on purpose.
 *
 * **Bold** marks a button, a tab or a field exactly as it reads on screen. A picture's pins put a
 * numbered marker on a part of the screenshot: { 2: 'save' } marks step 2 on the box named "save"
 * (the boxes are in shots.json, made by showcase/guide/images.py from the showcase captures).
 * Times like '2:44' point into the tour video on YouTube.
 */

export const VIDEO_ID = 'lytYE9LJOAk';
export const VIDEO_URL = `https://youtu.be/${VIDEO_ID}`;
export const VIDEO_LENGTH = '9:25';

export type TabId = 'start' | 'hr' | 'payroll' | 'client' | 'app' | 'website' | 'faq';

export interface Pic {
  shot: string;
  pins?: Record<number, string>;
  caption?: string;
}

export interface Topic {
  id: string;
  title: string;
  /** who does this, in plain words */
  who?: string;
  lead: string;
  pics?: Pic[];
  steps?: string[];
  tips?: string[];
  /** where it is shown in the tour video, m:ss */
  video?: string;
  /** also shown in the client portal's Help */
  client?: boolean;
}

export interface Section {
  id: Exclude<TabId, 'faq'>;
  label: string;
  intro: string;
  topics: Topic[];
}

export interface Faq {
  group: string;
  q: string;
  a: string[];
  /** also shown in the client portal's Help */
  client?: boolean;
  /** shown only in the client portal's Help */
  clientOnly?: boolean;
}

/** Chapters of the tour video. */
export const CHAPTERS: { at: string; label: string }[] = [
  { at: '0:00', label: 'Introduction' },
  { at: '0:09', label: 'The website' },
  { at: '1:10', label: 'The HR portal' },
  { at: '2:44', label: 'Payroll' },
  { at: '4:31', label: 'The client portal' },
  { at: '5:36', label: 'The employee app' },
  { at: '6:21', label: 'One time in, seen in three places' },
  { at: '8:22', label: 'Detachment commanders' },
];

export const seconds = (at: string) => at.split(':').reduce((s, part) => s * 60 + Number(part), 0);

/** The four parts of the system, on the Start here tab. */
export const PARTS = [
  { name: 'Website', who: 'Applicants, companies, banks', what: 'Applicants apply for open posts. Companies ask for a security proposal. Anyone checks a certificate of employment.' },
  { name: 'HR portal', who: 'HR, payroll, operations, management', what: 'The office: 201 files, posts and deployment, attendance, requests, payroll, discipline and announcements.' },
  { name: 'Client portal', who: 'People at each client company', what: 'On a tablet at the client\'s desk: their posts, guards on duty, attendance, cutoffs to confirm, reports and requests.' },
  { name: 'Employee app', who: 'Guards and detachment commanders', what: 'Time in and out at the post, payslips, leave, certificates, licenses and notices. Commanders run their post from it.' },
];

/** Who can do what, on the Start here tab. */
export const ROLES: { role: string; can: string }[] = [
  { role: 'Super admin', can: 'Everything, including staff accounts and roles.' },
  { role: 'HR admin', can: 'All HR and payroll work, the final approval of leave, and the audit log.' },
  { role: 'HR staff', can: '201 files, licenses and documents, leave and certificates, recruitment, announcements and discipline.' },
  { role: 'Payroll', can: 'Cutoffs, pay rules and rates, payslips, the 13th month and payroll concerns.' },
  { role: 'Operations', can: 'Posts and clients, deployment, client portal logins and requests, incident reports, announcements and proposal requests.' },
  { role: 'Management', can: 'The dashboard and the lists, to read.' },
  { role: 'Commander or inspector', can: 'In the app: their post, leave to endorse, time in for a guard without a phone, and incident reports.' },
  { role: 'Employee', can: 'In the app: their own time in and out, payslips, leave, certificates, licenses and notices.' },
  { role: 'Client', can: 'In the client portal: their own posts only.' },
];

export const SECTIONS: Section[] = [
  // ------------------------------------------------------------------ start here
  {
    id: 'start',
    label: 'Start here',
    intro: 'Bannuar\'s system has four parts that share the same records, so a guard\'s time in, a client\'s dispute or HR\'s decision shows up everywhere it should, at once.',
    topics: [
      {
        id: 'one-system',
        title: 'One time in, seen in three places',
        lead: 'When Bea times in at 5:52 PM on her phone, the same log appears in HR\'s attendance list and on the client\'s tablet. Nobody types it twice.',
        pics: [{ shot: 'one-system', caption: 'The guard\'s phone, the HR portal and the client\'s tablet, from the tour video.' }],
        video: '6:21',
      },
      {
        id: 'setup',
        title: 'Set up your staff account',
        who: 'New office staff',
        lead: 'Office staff join by invitation. Ask an admin for one: they make it in **Users and roles** and give you an 8-letter code. Then open the portal and choose **Set up your account** on the sign-in page.',
        pics: [{ shot: 'hr-setup', pins: { 1: 'email', 2: 'code', 3: 'name', 4: 'password', 5: 'make' } }],
        steps: [
          'Enter your work **Email**, the same one the invitation was made for.',
          'Type the **Invitation code** you were given.',
          'Enter **Your name** as colleagues should see it.',
          'Choose a **Password** of at least 8 characters, and type it again.',
          'Click **Make my account**. Your roles come with the invitation.',
        ],
      },
      {
        id: 'sign-in',
        title: 'Sign in',
        who: 'Office staff and clients',
        lead: 'Staff and client logins use the same sign-in page. Each person sees only what their role allows.',
        pics: [{ shot: 'hr-signin', pins: { 1: 'email', 2: 'password', 3: 'signin', 4: 'forgot' } }],
        steps: [
          'Enter your **Email**.',
          'Enter your **Password**.',
          'Click **Sign in**.',
          'Forgot it? **Forgot your password?** sends a link to your email to choose a new one.',
        ],
        client: true,
      },
      {
        id: 'find-your-way',
        title: 'Find your way around',
        lead: 'The menu on the left holds every page your role uses. Red numbers show what waits for a decision.',
        pics: [{ shot: 'hr-dashboard', pins: { 1: 'nav', 2: 'jump', 3: 'bell', 4: 'waiting' } }],
        steps: [
          'The menu groups the pages: People, Work and Administration. The gold lamp marks where you are.',
          '**Jump to** finds an employee, a post or a page as you type. Press Ctrl K (⌘K on a Mac) from anywhere.',
          '**Notifications** lists new requests, applications and proposal requests. Click one to open it.',
          '**Waiting for you** on the dashboard lists every decision in line. Click a line to go there.',
        ],
        tips: ['On a phone, the menu opens from the **Menu** button at the top.'],
      },
    ],
  },

  // ------------------------------------------------------------------ the HR portal
  {
    id: 'hr',
    label: 'HR portal',
    intro: 'Everyday work for HR and operations: guards\' 201 files, posts and deployment, attendance, requests, discipline, announcements and recruitment.',
    topics: [
      {
        id: 'dashboard',
        title: 'The dashboard',
        who: 'Everyone in the office',
        lead: 'The first page after signing in. It starts with what waits for you, then the day at a glance.',
        pics: [{ shot: 'hr-dashboard', pins: { 1: 'waiting', 2: 'tiles0' } }],
        steps: [
          '**Waiting for you**: leave for approval, certificates to issue, contact detail changes, payroll concerns, new applications and proposal requests. A red count is past its deadline.',
          'The tiles: guards on the roll, today\'s time in and out (and how many need a look), guards floating near the six-month limit, and expired documents.',
          'Further down: the guards at each post against the number needed, short posts first, and the roll by status.',
        ],
        video: '1:22',
      },
      {
        id: 'employees',
        title: 'Find or add an employee',
        who: 'HR',
        lead: 'Every guard and office employee has a 201 file. The list finds anyone in a few keystrokes.',
        pics: [{ shot: 'hr-employees', pins: { 1: 'search', 2: 'toolbar0', 3: 'add' } }],
        steps: [
          'Search by name or employee number.',
          'Filter by status (active, floating, on leave and more) and by post.',
          '**Add an employee**: fill in at least the employee number, first and last name and mobile number, then click **Add employee**. The new 201 file opens.',
        ],
        tips: ['The employee number and the mobile number are what the guard uses to activate the app, so type them carefully.'],
        video: '1:38',
      },
      {
        id: 'file-201',
        title: 'The 201 file',
        who: 'HR',
        lead: 'One page for each person, with a tab for each part of their record.',
        pics: [{ shot: 'hr-employee', pins: { 1: 'tabs', 2: 'edit' } }],
        steps: [
          'The tabs: Profile, Deployment, Attendance, Licenses and documents, Government numbers, Pay rate, Payslips, Leave, Certificates and App account. Each role sees the tabs it uses.',
          '**Edit the profile** to correct a name, birthday, address or contact details.',
        ],
        tips: [
          'Government numbers stay hidden until you click **Show the numbers**. Each time is recorded in the audit log.',
          'Deployment shows where the guard is posted now, and every post they held before, with dates.',
        ],
        video: '1:45',
      },
      {
        id: 'documents',
        title: 'Licenses and documents',
        who: 'HR',
        lead: 'Security licenses (LESP), clearances and test results, each with its expiry. When a guard sends a photo of a license from the app, Claude reads it first.',
        pics: [
          { shot: 'hr-employee-docs', pins: { 1: 'claude', 2: 'verify', 3: 'adddoc' } },
          { shot: 'hr-compliance', caption: '**Licenses and documents** in the menu: what has expired, expires soon, or is missing for deployment.' },
        ],
        steps: [
          'Claude\'s reading: the license number, the dates and the name, and where they differ from what was entered.',
          'Look at the scan, then **Verify** it, or **Reject** it with a reason.',
          '**Add a document** to file a scan yourself: choose the kind, the dates, and the scan or photo.',
        ],
        tips: ['Claude helps you read; it never verifies anything. HR always decides.'],
        video: '1:52',
      },
      {
        id: 'posts',
        title: 'Posts and deployment',
        who: 'Operations',
        lead: 'Each client has posts. A post has its guards, its shifts, its pay and the place where guards time in.',
        pics: [
          { shot: 'hr-post', pins: { 1: 'deploy', 2: 'guards', 3: 'location' } },
          { shot: 'hr-deploy', pins: { 4: 'pick', 5: 'deploy' } },
        ],
        steps: [
          '**Deploy guards here** sends floating guards to this post.',
          '**Guards at this post** lists who is deployed. **Set to floating** takes a guard off the post.',
          '**Location for time in and out**: where the post is and how far a guard may be. **Set the location** (or **Edit the post**), paste the location from Google Maps, and set the **Allowed distance (metres)**.',
          'Tick the guards to send.',
          'Choose the duty and the shift, then click the **Deploy** button. Each guard\'s assignment history records the date.',
        ],
        tips: ['Add posts and clients from **Posts and clients**: **Add a post**, and on the **Clients** tab, **Add a client**.'],
      },
      {
        id: 'attendance',
        title: 'Attendance',
        who: 'HR and operations',
        lead: 'Every time in and out from the app, with a photo taken then, the server\'s time, and the distance from the post. GPS can be off indoors and can be faked, so the photo and the flags help you judge.',
        pics: [
          { shot: 'hr-attendance', pins: { 1: 'which', 2: 'photo', 3: 'away', 4: 'manual' } },
          { shot: 'hr-attendance-log', caption: 'A log opened: the photo, the time, and where the phone was.' },
        ],
        steps: [
          '**Which logs**: all of them, those that **Needs a look** (away from the post, location unclear or missing, or a mock location app), or those **By the commander or by hand**.',
          'Click a photo to see it large, with the place on the map (**Open in Google Maps**).',
          'The flag says what to check. **Away from the post** shows how far.',
          '**Add a manual log** when a guard could not log, for example a lost phone: the employee, the date and time, and a reason. The employee is told.',
        ],
        video: '2:01',
      },
      {
        id: 'leave',
        title: 'Leave',
        who: 'Commanders, then HR',
        lead: 'Guards file leave in the app. Their detachment commander endorses it with a reliever, then HR decides.',
        pics: [{ shot: 'hr-leave-approve', pins: { 3: 'save' } }],
        steps: [
          'The guard files the leave in the app, with the dates and the reason.',
          'The commander endorses it and names the reliever who covers the post (or does not endorse it, with a note).',
          'In **Requests**, on the **Leave** tab, click **Approve** (or **Decline**), add a note if needed, then **Save the decision**.',
          'The guard is told in the app, and the leave credits are updated.',
        ],
        video: '2:17',
      },
      {
        id: 'certificates',
        title: 'Certificates of employment',
        who: 'HR',
        lead: 'Guards request a certificate from the app, for a loan or a new job. DOLE requires it within three days, so each request shows its due date.',
        pics: [
          { shot: 'hr-coe', pins: { 1: 'overdue', 2: 'issue' } },
          { shot: 'hr-coe-issue', pins: { 3: 'signed', 4: 'comp', 5: 'issue' } },
          { shot: 'hr-coe-pdf', caption: 'The certificate: signed, numbered, with a code and a QR link that anyone can check on Bannuar\'s website.' },
        ],
        steps: [
          '**Requests** → **Certificates of employment**. A late request is marked **Overdue**.',
          'Click **Issue** on the request.',
          'Check who signs: **Signed by** and the title.',
          'If the employee asked for it, type the compensation as it should print, for example "₱540.00 a day".',
          'Click **Issue the certificate**. The PDF downloads, and the employee gets it in the app.',
        ],
        tips: ['For a walk-in, open the employee\'s page, **Certificates** tab, **Issue a certificate**.'],
        video: '2:24',
      },
      {
        id: 'contact-changes',
        title: 'Contact detail changes',
        who: 'HR',
        lead: 'Guards ask for a new mobile number or address in the app (**Change my details**). Nothing changes in the 201 file until HR applies it.',
        pics: [{ shot: 'hr-changes', pins: { 1: 'apply' } }],
        steps: ['In **Requests** → **Contact detail changes**, check the change, then **Apply** it to the 201 file or **Decline** it.'],
      },
      {
        id: 'incident-reports',
        title: 'Incident reports',
        who: 'HR and operations',
        lead: 'Reports from clients, commanders and staff, about a guard or about the post.',
        pics: [
          { shot: 'hr-reports', pins: { 1: 'first', 2: 'file' } },
          { shot: 'hr-report', pins: { 3: 'status', 4: 'update', 5: 'opencase' } },
        ],
        steps: [
          '**Discipline** → **Incident reports**. Click a report to open it.',
          '**File a report** to record one yourself.',
          'Set the **Status** as you look into it.',
          'Write an **Update for the client**. The client reads it in their portal.',
          '**Open a case from this report** when someone has to answer for it.',
        ],
      },
      {
        id: 'discipline-cases',
        title: 'Discipline cases, with due process',
        who: 'HR',
        lead: 'Every case follows the same steps, and the employee is told in the app at each one.',
        pics: [{ shot: 'hr-discipline-case', pins: { 2: 'panel1', 3: 'panel2', 4: 'panel3' } }],
        steps: [
          'Open a case (from a report, or **Open a case** on the **Cases** tab) with the employee, the facts and the rule. **Ask Claude for a suggestion** to find the matching rule in your Code of Discipline; you choose.',
          '**Issue the notice** to explain. The employee gets it in the app, with at least five days to answer.',
          'The employee answers in the app or on paper; HR records a paper answer.',
          'If the employee asks for a hearing, set it (**Set the hearing**).',
          'Write the decision. The code\'s penalty is the starting point; a lighter one needs a reason. **Issue the decision**.',
        ],
        tips: ['The **Cases** list says what each case waits for, such as "Issue the notice to explain" or "Decide".'],
        video: '3:54',
      },
      {
        id: 'code-of-discipline',
        title: 'The Code of Discipline',
        who: 'HR',
        lead: 'Upload the company\'s Code of Discipline once. Claude reads it into rules: each offense with its penalties, in the code\'s own words and page.',
        pics: [{ shot: 'hr-discipline-code', pins: { 1: 'upload', 2: 'table0', 3: 'inforce' } }],
        steps: [
          '**Discipline** → **Code of Discipline** → **Upload the code (PDF)**.',
          'Check each rule Claude proposes. **Edit** where needed, then approve them. Claude also lists clauses for your lawyer to look at.',
          '**Put this code in force** once every rule is reviewed. New cases use it.',
        ],
        video: '3:46',
      },
      {
        id: 'announcements',
        title: 'Announcements',
        who: 'HR and operations',
        lead: 'Memos and advisories that reach the guards\' app with a notification.',
        pics: [
          { shot: 'hr-announcements', pins: { 1: 'write' } },
          { shot: 'hr-announce-write', pins: { 2: 'audience', 3: 'publish' } },
        ],
        steps: [
          '**Write an announcement**: a title and the message.',
          '**Who it is for**: everyone, an area, or chosen posts.',
          '**Publish now**, or **Save as a draft** to finish later.',
        ],
        tips: ['The list shows how many have read it and how many acknowledged it.'],
        video: '4:03',
      },
      {
        id: 'recruitment',
        title: 'Recruitment',
        who: 'HR',
        lead: 'Applications sent from the website\'s careers page, and the open posts the website lists.',
        pics: [{ shot: 'hr-recruitment', pins: { 1: 'file', 2: 'hire' } }],
        steps: [
          'Open an application to see the applicant\'s details and their resume (**Open the attached file**). Keep notes and a status.',
          '**Hire**: give the new employee number, then **Create the employee record**. Their 201 file opens.',
        ],
        tips: ['The **Open posts on the website** tab lists what the careers page shows. **Add an open post** to advertise one.'],
        video: '4:10',
      },
      {
        id: 'proposal-requests',
        title: 'Proposal requests',
        who: 'Operations',
        lead: 'Companies that asked for guards through the website: where, how many and which hours.',
        pics: [{ shot: 'hr-inquiries' }],
        steps: ['Call the company back, then keep the status of the request current.'],
      },
      {
        id: 'client-logins',
        title: 'Client portal logins and requests',
        who: 'Operations',
        lead: 'Each client company can have its own logins to the client portal. They see their own posts and nothing else.',
        pics: [
          { shot: 'hr-client-access', pins: { 1: 'name', 2: 'email', 3: 'invite', 4: 'off' } },
          { shot: 'hr-client-requests', caption: '**Requests** → **Client requests**: answer what clients ask for.' },
        ],
        steps: [
          'Open **Posts and clients** → **Clients** → **Portal access**, and enter the person\'s **Name**.',
          'Enter their **Email**.',
          '**Invite to the client portal**, then give them the code shown. They set up their login with **Set up your account** on the sign-in page.',
          '**Turn off** a login when someone leaves the client.',
        ],
        tips: ['Client requests (more guards, a replacement, a new schedule) arrive in **Requests** → **Client requests**. Set the status and write an answer: the client sees it in their portal.'],
        video: '4:38',
      },
      {
        id: 'staff-roles',
        title: 'Staff accounts and roles',
        who: 'Super admin',
        lead: 'Office staff sign up with an invitation code. Their roles decide what they see.',
        pics: [
          { shot: 'hr-users', pins: { 1: 'invite', 4: 'roles' } },
          { shot: 'hr-invite', pins: { 2: 'name', 3: 'make' } },
        ],
        steps: [
          '**Users and roles** → **Invite someone**.',
          'Enter the person\'s name and email, and tick their roles.',
          '**Make the invitation**, then give them the code (**Copy the code**). They use it on **Set up your account**.',
          '**Change roles** at any time. **Temporary password** helps someone who cannot sign in.',
        ],
        tips: ['See **Who can do what** on the Start here tab for what each role covers.'],
        video: '4:17',
      },
      {
        id: 'app-account',
        title: 'A guard\'s app account',
        who: 'HR',
        lead: 'Guards activate the app themselves with their employee number, birthday and mobile number. The **App account** tab shows whether a guard has, and what they must type.',
        pics: [{ shot: 'hr-employee-account', pins: { 1: 'panel0' } }],
        steps: [
          'Not activated yet: check that the birthday and mobile number on file are right. If one is missing, add it to the profile first.',
          'Forgot the password? Once the guard has activated, this tab has **Give a temporary password**. Give it to the guard in person; the app asks them to choose their own at the next sign-in.',
        ],
      },
      {
        id: 'audit-log',
        title: 'Audit log',
        who: 'HR admin',
        lead: 'Who changed what, and every time someone opened an employee\'s government numbers.',
        pics: [{ shot: 'hr-audit' }],
        steps: ['Filter by the kind of record to find a change, then read who made it and when.'],
        video: '4:24',
      },
      {
        id: 'settings',
        title: 'Settings',
        who: 'HR, payroll and operations',
        lead: 'The lists the rest of the portal and the app use.',
        steps: [
          '**Areas**: the areas posts belong to, so an announcement can go to one area.',
          '**Document types**: the licenses and documents you track, and which ones Claude reads when a guard uploads them.',
          '**Leave types**: the kinds of leave and their yearly credits.',
          '**Pay rules and rates**: see the Payroll tab of this guide.',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ payroll
  {
    id: 'payroll',
    label: 'Payroll',
    intro: 'From time in and out to published payslips. Each client has a pay rule, each post an hourly rate, and each duty comes from the guards\' own time in and out.',
    topics: [
      {
        id: 'pay-rules',
        title: 'Pay rules',
        who: 'Payroll',
        lead: 'An agency default rule, plus a rule for each client that pays its own way. Each line of the payslip is a formula payroll can read, such as rate × 125% × overtime hours.',
        pics: [
          { shot: 'hr-pay-rules', pins: { 1: 'edit' } },
          { shot: 'hr-pay-rule', pins: { 2: 'formula' } },
        ],
        steps: [
          '**Settings** → **Pay rules and rates**, then **Edit** a rule (or add one for a client).',
          'Each line has a code, a name and a formula. Use the names listed under the formulas, such as rate, regular hours, overtime hours and night hours. A mistake is pointed out as you type. **Add a line** for an allowance.',
          'The example shows a sample cutoff worked out with the rule, so you can check the result. Then **Save the rule**.',
        ],
        video: '2:44',
      },
      {
        id: 'night-differential',
        title: 'Night differential',
        who: 'Payroll',
        lead: 'Each rule says who earns the night differential. As Bannuar pays it, the last guard of the day earns 10% of the hourly rate for 8 hours.',
        pics: [{ shot: 'hr-pay-rule-2', pins: { 1: 'example' } }],
        steps: [
          'In the rule, **Night differential goes to**: the **last shift of the day** (24-hour duties, and the shift from 6pm at 12-hour posts or 10pm at 8-hour posts), or **every hour worked from 10pm to 6am**, as the Labor Code counts it.',
        ],
        tips: ['The example in the rule shows a guard on the 6 PM shift and the night differential they earn.'],
        video: '2:53',
      },
      {
        id: 'post-rates',
        title: 'The hourly rate at each post',
        who: 'Payroll',
        lead: 'Posts of the same client can pay different rates. A rate starts on a date, so a new rate never changes the months before it.',
        pics: [{ shot: 'hr-post-pay', pins: { 1: 'pay' } }],
        steps: [
          'Open the post (**Posts and clients**). **Pay at this post** shows the pay rule, the shifts and the rates by date.',
          'To change the rate, fill **New rate from** and **Hourly rate (₱)**, then **Add the rate**.',
          'If this post pays differently from the client\'s default, choose another **Pay rule**.',
        ],
        video: '3:01',
      },
      {
        id: 'new-cutoff',
        title: 'Start a cutoff',
        who: 'Payroll',
        lead: 'A cutoff holds a pay period\'s payslips, from its duties to the published payslips.',
        pics: [{ shot: 'hr-payroll', pins: { 1: 'new' } }],
        steps: ['**Payroll** → **New cutoff**: the **First day**, the **Last day** and the **Pay date**, then **Create the cutoff**.'],
      },
      {
        id: 'check-duties',
        title: 'Check the duties',
        who: 'Payroll',
        lead: 'Each duty comes from time in and out. Clean duties count on their own; payroll decides only the few that need a look.',
        pics: [{ shot: 'hr-cutoff-2', pins: { 1: 'count', 2: 'notcount', 3: 'ask' } }],
        steps: [
          'A duty that needs a look says why: away from the post, no time out, logged by hand. **Count** it if it was served.',
          '**Don\'t count** it if it was not, with a reason. The guard is told.',
          '**Ask the client to confirm (2 days)**: each client confirms its posts\' duties, or disputes one, in the client portal. No answer in two days counts as confirmed, and pay is never held for it.',
        ],
        tips: ['A duty a client disputed shows the client\'s reason, so you can decide it.'],
        video: '3:09',
      },
      {
        id: 'work-out-pay',
        title: 'Work out pay',
        who: 'Payroll',
        lead: 'The portal works out every guard\'s pay from the days that count, each post\'s rate and its client\'s rule.',
        pics: [{ shot: 'hr-work-out-pay', pins: { 1: 'fill', 2: 'sheet', 3: 'save' } }],
        steps: [
          'On the cutoff, **Work out pay**, then **Fill the days from time in and out**.',
          'To check or change days in a spreadsheet, **Download the attendance sheet**, edit it, and upload it back.',
          '**Save** the payslips: basic pay, overtime and night differential for each guard.',
        ],
        video: '3:25',
      },
      {
        id: 'import-payroll',
        title: 'Or import a payroll file',
        who: 'Payroll',
        lead: 'Still working in your own payroll spreadsheet? Import it instead of working out pay.',
        pics: [{ shot: 'hr-import', pins: { 1: 'template', 2: 'file' } }],
        steps: [
          'On the cutoff, **Import the payroll file**. **Download the template** to see the columns.',
          'Choose your file. Columns are matched by their names, and rows with a problem are listed before anything is saved.',
        ],
      },
      {
        id: 'publish',
        title: 'Publish payslips',
        who: 'Payroll',
        lead: 'Guards see their payslips in the app once the cutoff is published.',
        pics: [{ shot: 'hr-cutoff', pins: { 1: 'publish' } }],
        steps: [
          '**Publish to employees**. Each guard gets a notification.',
          'Made a mistake? **Unpublish**, correct it, and publish again.',
        ],
        tips: ['Any payslip opens with **View**, and **Download PDF** gives the payslip as a PDF.'],
      },
      {
        id: 'thirteenth-month',
        title: '13th month pay',
        who: 'Payroll',
        lead: 'A twelfth of the basic pay earned in the year, worked out for each stretch a guard held a post, at that post\'s rate.',
        pics: [{ shot: 'hr-13th', pins: { 1: 'tabs', 2: 'dante', 3: 'create' } }],
        steps: [
          '**Payroll** → **13th month**. **Timeline** shows each guard\'s year post by post; **List** shows the figures.',
          'Point at a bar, or click **How**, to see the working. Dante moved posts this year: ₱5,200 + ₱10,920 + ₱5,200 makes ₱21,320.',
          '**Create the payout cutoff**: a cutoff with a 13th month line for each employee, due by 24 December.',
        ],
        video: '3:34',
      },
      {
        id: 'payroll-concerns',
        title: 'Payroll concerns',
        who: 'Payroll',
        lead: 'Guards report a problem with a payslip from the app (**Report a concern**).',
        pics: [{ shot: 'hr-concerns', pins: { 1: 'answer' } }],
        steps: ['**Requests** → **Payroll concerns** → **Answer**: set the status and write the **Answer to the employee**. They read it in the app.'],
      },
    ],
  },

  // ------------------------------------------------------------------ the client portal
  {
    id: 'client',
    label: 'Client portal',
    intro: 'For the people at each client company, made for a tablet at their desk. They see their own posts only: never pay, addresses, government numbers, photos, locations or discipline records.',
    topics: [
      {
        id: 'client-start',
        title: 'Getting a login',
        who: 'Clients',
        lead: 'Bannuar\'s operations team invites each person at the client. The login opens the client portal, at the same address as the HR portal.',
        steps: [
          'You receive an invitation code from Bannuar.',
          'Open the portal and choose **Set up your account**: your email, the code, your name and a password.',
          'On a tablet, choose **Add to Home Screen** in the browser: the portal then opens full screen, like an app.',
        ],
        client: true,
      },
      {
        id: 'client-posts',
        title: 'Who is on duty now',
        who: 'Clients',
        lead: 'Each post with its guards, and since when each one has been on duty.',
        pics: [{ shot: 'client-posts', pins: { 1: 'tabs', 2: 'onduty' } }],
        steps: [
          'The tabs at the top: **Posts and guards**, **Attendance**, **Cutoffs to confirm**, **Incident reports** and **Requests**.',
          'A guard on duty shows **On duty since** and the time they timed in.',
        ],
        video: '4:47',
        client: true,
      },
      {
        id: 'client-attendance',
        title: 'Attendance by day',
        who: 'Clients',
        lead: 'When each guard came and left, and whether they were at the post. No photos and no locations.',
        pics: [{ shot: 'client-attendance', pins: { 1: 'day' } }],
        steps: ['Pick the **Day**. Each log shows the guard, the time, and whether it was at the post or logged by the commander.'],
        video: '4:56',
        client: true,
      },
      {
        id: 'client-cutoff',
        title: 'Confirm each cutoff',
        who: 'Clients',
        lead: 'At each cutoff, the client confirms the duties that were served, or disputes one that was not.',
        pics: [
          { shot: 'client-cutoff', pins: { 1: 'dispute', 2: 'confirm' } },
          { shot: 'client-cutoff-disputed', pins: { 3: 'send' } },
        ],
        steps: [
          'Check the duties. **Dispute** one that was not served, and say what was wrong.',
          'If every duty was served, **Confirm the cutoff**.',
          'With a dispute, the button reads **Send with 1 disputed**. Bannuar looks into each disputed duty.',
        ],
        tips: ['No answer in two days counts as confirmed.'],
        video: '5:04',
        client: true,
      },
      {
        id: 'client-reports',
        title: 'Report an incident',
        who: 'Clients',
        lead: 'About a guard or about the post. You see Bannuar\'s status and update on each report.',
        pics: [
          { shot: 'client-reports', pins: { 1: 'report' } },
          { shot: 'client-report-form' },
        ],
        steps: [
          '**Report an incident**: the post, the guard if you know them, when it happened, and what happened.',
          '**Send the report**. It goes to Bannuar\'s office.',
        ],
        tips: ['In an emergency at a post, call the detachment commander there.'],
        video: '5:19',
        client: true,
      },
      {
        id: 'client-requests',
        title: 'Ask for more guards',
        who: 'Clients',
        lead: 'More guards, a replacement, or a change of schedule. Operations answers here.',
        pics: [
          { shot: 'client-requests', pins: { 1: 'ask' } },
          { shot: 'client-request-form', pins: { 2: 'send' } },
        ],
        steps: [
          '**Ask for something**: what you need, how many guards, from when, and the details.',
          '**Send the request**. Bannuar\'s answer shows on the request.',
        ],
        video: '5:27',
        client: true,
      },
    ],
  },

  // ------------------------------------------------------------------ the employee app
  {
    id: 'app',
    label: 'Employee app',
    intro: 'The Bannuar app on every guard\'s phone. The steps are written as the guard does them, so you can walk a guard through them.',
    topics: [
      {
        id: 'app-activate',
        title: 'Start using the app',
        who: 'Guards',
        lead: 'Each guard activates the app once with the details in their 201 file. After that, they sign in with their employee number and password.',
        pics: [
          { shot: 'app-signin', pins: { 1: 'activate' } },
          { shot: 'app-activate', pins: { 2: 'number', 3: 'birthdate', 4: 'mobile', 5: 'password' } },
        ],
        steps: [
          'Open the Bannuar app and tap **First time? Activate your account**.',
          'Enter your **Employee number**.',
          'Your **Birthdate**, as in your 201 file.',
          'Your **Mobile number**, as in your 201 file.',
          'Choose a password (at least 8 characters, with letters and numbers), type it again, and tap **Activate**.',
        ],
        tips: ['Details do not match? Ask HR to check your 201 file. Forgot your password? Ask HR for a temporary password.'],
        video: '5:43',
      },
      {
        id: 'app-home',
        title: 'Home',
        who: 'Guards',
        lead: 'Today at a glance.',
        pics: [{ shot: 'app-home', pins: { 1: 'timein', 2: 'post', 3: 'notice', 4: 'bell', 5: 'tabbar' } }],
        steps: [
          '**Time in** and **Time out**.',
          'Your post.',
          'Notices from HR that wait for you.',
          'Notifications.',
          'The tabs: Home, Payslips, Leave and More.',
        ],
        video: '5:50',
      },
      {
        id: 'app-time-in',
        title: 'Time in and time out',
        who: 'Guards',
        lead: 'At the post, at the start and end of every duty.',
        pics: [
          { shot: 'app-timein-located', pins: { 1: 'atpost', 2: 'photo' } },
          { shot: 'app-timein-photo', pins: { 3: 'log' } },
          { shot: 'app-timein-logged', pins: { 4: 'done' } },
        ],
        steps: [
          'Tap **Time in**. The phone finds where you are and checks it against your post.',
          '**Take my photo** at your post, with the front camera.',
          'Tap **Log time in**.',
          'Logged, by the server\'s clock, not the phone\'s. Tap **Done**. Time out works the same way.',
        ],
        tips: [
          'Away from the post? Wait a moment, then **Find my location again**. You can still log, and HR sees why.',
          'The app reads your location only while you log, never in the background.',
        ],
        video: '5:58',
      },
      {
        id: 'app-payslips',
        title: 'Payslips',
        who: 'Guards',
        lead: 'Every payslip, once payroll publishes the cutoff. Pay stays private: amounts are hidden until you tap, and screenshots are blocked.',
        pics: [
          { shot: 'app-payslip-hidden', pins: { 1: 'eye' } },
          { shot: 'app-payslip', pins: { 2: 'net' } },
          { shot: 'app-payslip-lines', caption: 'Every line of the payslip. **Report a concern** is at the bottom.' },
        ],
        steps: [
          'Open a payslip and tap **Show the amounts**.',
          'Net pay first, then every line: basic pay, overtime, night differential and each deduction.',
          'Something wrong? **Report a concern**. Payroll answers in the app (More → Payroll concerns).',
        ],
        video: '6:34',
      },
      {
        id: 'app-leave',
        title: 'Leave',
        who: 'Guards',
        lead: 'Credits left this year, and every request with where it stands.',
        pics: [
          { shot: 'app-leave', pins: { 1: 'file' } },
          { shot: 'app-leave-form', pins: { 2: 'submit' } },
          { shot: 'app-leave-filed', pins: { 3: 'request' } },
        ],
        steps: [
          'On the **Leave** tab, tap **File leave**.',
          'Choose the **Kind of leave**, the **First day** and **Last day**, a reason, and a supporting document when needed. Tap **File leave**.',
          'Follow it: with the commander, with HR, then approved or declined with the reason.',
        ],
        video: '6:55',
      },
      {
        id: 'app-certificates',
        title: 'Certificates of employment',
        who: 'Guards',
        lead: 'For a loan, a new job or anything else. HR issues it within three days.',
        pics: [
          { shot: 'app-coe', pins: { 1: 'request' } },
          { shot: 'app-coe-form', pins: { 2: 'submit' } },
          { shot: 'app-cert', pins: { 3: 'code' } },
        ],
        steps: [
          'More → **Certificates of employment** → **Request a certificate**.',
          '**What is it for?**, any details, and who it is addressed to. Tap **Request a certificate**.',
          'When it is issued, open it: show the PDF or the code. Anyone can check the code on Bannuar\'s website.',
        ],
        video: '7:16',
      },
      {
        id: 'app-announcements',
        title: 'Announcements',
        who: 'Guards',
        lead: 'Memos and advisories from HR and operations. Some ask you to confirm you read them.',
        pics: [{ shot: 'app-announcement', pins: { 1: 'ack' } }],
        steps: ['Read it, then tap **I acknowledge**. HR sees who has.'],
        video: '7:31',
      },
      {
        id: 'app-documents',
        title: 'Renew a license',
        who: 'Guards',
        lead: 'Your licenses and documents with their expiry. You are reminded before one expires.',
        pics: [
          { shot: 'app-documents', pins: { 1: 'lesp', 2: 'upload' } },
          { shot: 'app-upload', pins: { 3: 'photo' } },
          { shot: 'app-upload-checked', pins: { 4: 'send' } },
        ],
        steps: [
          'More → **Licenses and documents**: each one with its expiry.',
          'Tap **Upload a renewal**.',
          'Choose the document and **Take a photo** of the whole license.',
          'Claude reads the number, the dates and the name, and fills them in. Check them, then **Send to HR**. HR verifies it.',
        ],
        video: '7:38',
      },
      {
        id: 'app-notices',
        title: 'Notices from HR',
        who: 'Guards',
        lead: 'A notice to explain says the rule, what happened and the deadline. Hearings and decisions arrive here too.',
        pics: [
          { shot: 'app-notice', pins: { 1: 'by', 2: 'received' } },
          { shot: 'app-notice-explain', caption: 'The explanation, written in the app. **Send my explanation** is below it.' },
        ],
        steps: [
          '**Answer by** is your deadline: at least five days.',
          'Tap **I received this notice**.',
          'Write what happened and **Send my explanation**, or hand it to HR on paper.',
        ],
        video: '7:57',
      },
      {
        id: 'app-more',
        title: 'More: your records and account',
        who: 'Guards',
        lead: 'Everything else in the app, under the **More** tab.',
        pics: [
          { shot: 'app-more', pins: { 1: 'records' }, caption: '**Change my details** and **Account** are further down the list.' },
          { shot: 'app-home-dark', caption: 'Dark mode, for the night shift.' },
        ],
        steps: [
          '**My records**: your 201 file, to read. **Government numbers** are there too.',
          '**Change my details**: a new mobile number or address goes to HR to apply.',
          '**Account**: change your password, **Lock the app** with your fingerprint, face or phone PIN, choose the appearance (same as the phone, light or dark), read the privacy notice, or sign out.',
        ],
        tips: ['Notifications list payslips, announcements, licenses about to expire and certificates ready, so nothing is missed.'],
        video: '8:05',
      },
      {
        id: 'cmd-post',
        title: 'Commanders: my post',
        who: 'Detachment commanders',
        lead: 'A commander\'s app has **My post**: their guards, and the leave that waits for them.',
        pics: [
          { shot: 'cmd-home', pins: { 1: 'mypost' } },
          { shot: 'cmd-mypost', pins: { 2: 'leave', 3: 'guard', 4: 'report' } },
        ],
        steps: [
          'Tap **My post** on Home (or More → **My post**).',
          'Leave to endorse: tap a request to open it.',
          'Your guards: tap one to see their time in and out, or to log for them.',
          '**Report an incident** at the post.',
        ],
        video: '8:22',
      },
      {
        id: 'cmd-endorse',
        title: 'Commanders: endorse leave',
        who: 'Detachment commanders',
        lead: 'Before HR decides, the commander makes sure the post stays covered.',
        pics: [{ shot: 'cmd-endorse', pins: { 2: 'endorse' } }],
        steps: [
          'Choose the **Reliever** who covers the post while the guard is away.',
          '**Endorse to HR**, or **Do not endorse** with a note.',
        ],
        video: '8:36',
      },
      {
        id: 'cmd-log-for',
        title: 'Commanders: a guard without a phone',
        who: 'Detachment commanders',
        lead: 'A guard who came without a phone still gets their duty logged, by the commander, with the guard\'s photo.',
        pics: [
          { shot: 'cmd-guard', pins: { 1: 'log' } },
          { shot: 'cmd-log-for', pins: { 2: 'log' } },
        ],
        steps: [
          'In **My post**, tap the guard, then **Log time in for them**.',
          'Take the guard\'s photo at the post, then **Log time in**. The guard is told in their app, and HR sees it was logged by the commander.',
        ],
        video: '8:50',
      },
      {
        id: 'cmd-incident',
        title: 'Commanders: report an incident',
        who: 'Detachment commanders',
        lead: 'Straight to HR from the post, with the time and the guard involved.',
        pics: [{ shot: 'cmd-incident', pins: { 1: 'send' } }],
        steps: ['A title, what happened, and the guard involved if any. **Send to HR**.'],
        video: '9:04',
      },
    ],
  },

  // ------------------------------------------------------------------ the website
  {
    id: 'website',
    label: 'Website',
    intro: 'Bannuar\'s public website. What applicants, companies and banks do there, and where it lands in the portal.',
    topics: [
      {
        id: 'web-careers',
        title: 'Applying for a post',
        who: 'Applicants',
        lead: 'The careers page lists the open posts from **Recruitment** → **Open posts on the website**.',
        pics: [
          { shot: 'web-openings', pins: { 1: 'pick' } },
          { shot: 'web-applied', pins: { 2: 'done' } },
        ],
        steps: [
          'The applicant picks a post and fills the form, with their resume.',
          'The application arrives in **Recruitment** → **Applications**, and HR is notified.',
        ],
        video: '0:31',
      },
      {
        id: 'web-proposal',
        title: 'Asking for guards',
        who: 'Companies',
        lead: 'A company says where the post is, how many guards it needs and which hours.',
        pics: [{ shot: 'web-proposal' }],
        steps: ['The request arrives in **Proposal requests**. Call the company back to plan the post.'],
        video: '0:46',
      },
      {
        id: 'web-verify',
        title: 'Checking a certificate',
        who: 'Banks and employers',
        lead: 'Every certificate of employment has a code, and a QR code that opens this page.',
        pics: [{ shot: 'web-verify', pins: { 1: 'form0', 2: 'result' } }],
        steps: [
          'Type the code printed at the foot of the certificate, or scan its QR code.',
          'The site says whether it is genuine and still valid, with the name, the position and the dates.',
        ],
        video: '1:00',
      },
    ],
  },
];

export const FAQ: Faq[] = [
  // accounts
  { group: 'Accounts and signing in', q: 'How do new office staff get an account?', a: ['An admin opens **Users and roles** → **Invite someone**, ticks their roles, and gives them the 8-letter code. They open the portal, choose **Set up your account**, and use the code.'] },
  { group: 'Accounts and signing in', q: 'I forgot my portal password.', a: ['On the sign-in page, **Forgot your password?** sends a link to your email. An admin can also give you a **Temporary password** from **Users and roles**.'], client: true },
  { group: 'Accounts and signing in', q: 'A guard forgot their app password.', a: ['Open the guard\'s page, **App account** tab, and **Give a temporary password**. Give it to the guard in person. The app asks them to choose their own right after they sign in.'] },
  { group: 'Accounts and signing in', q: 'How does a new guard start using the app?', a: ['They open the app, tap **First time? Activate your account**, and enter their employee number, birthdate and mobile number as in their 201 file, then choose a password. If it does not work, check the birthday and mobile number on the **App account** tab of their page.'] },
  { group: 'Accounts and signing in', q: 'Can I use the portal on my phone?', a: ['Yes. The menu opens from the **Menu** button at the top, and wide lists scroll inside their panel.'] },
  { group: 'Accounts and signing in', q: 'How do I find someone quickly?', a: ['Press Ctrl K (⌘K on a Mac), or click **Jump to** at the top, and type part of a name, an employee number, a post or a page.'] },

  // attendance
  { group: 'Attendance', q: 'Why does a time in say "Away from the post"?', a: ['The phone was farther from the post than the allowed distance set for it. GPS can be off indoors, so the guard can still log, and HR sees the distance and the photo.', 'In the cutoff, payroll decides whether that duty counts. If many logs at one post are away, check the post\'s location (**Set the location** on its page).'] },
  { group: 'Attendance', q: 'A guard came without a phone. How is the duty logged?', a: ['The detachment commander logs it from the app (**My post** → the guard → **Log time in for them**), with the guard\'s photo. If that is not possible, HR adds a log in **Attendance** → **Add a manual log**, with a reason. The guard is told either way.'] },
  { group: 'Attendance', q: 'What is a "mock location app"?', a: ['An app that fakes the phone\'s location. A time in made while one is on is flagged for HR to look at.'] },
  { group: 'Attendance', q: 'Does the app track guards all day?', a: ['No. The app reads the location only while a guard logs a time in or out, never in the background.'] },

  // pay
  { group: 'Pay', q: 'How is the night differential worked out?', a: ['By each client\'s pay rule. As Bannuar pays it, the guard on the last shift of the day (the 6 PM shift at a 12-hour post, or a 24-hour duty) earns 10% of the hourly rate for 8 hours. A rule can instead pay every hour worked from 10 PM to 6 AM. Payroll sets it in **Settings** → **Pay rules and rates**.'] },
  { group: 'Pay', q: 'A post\'s rate changes. What happens to earlier pay and to the 13th month?', a: ['A rate starts on a date, so earlier months keep their rate. The 13th month adds up each stretch at the rate in force then, post by post.'] },
  { group: 'Pay', q: 'When do guards see their payslips?', a: ['When payroll clicks **Publish to employees** on the cutoff. Each guard gets a notification. Amounts stay hidden until they tap, and screenshots are blocked on payslips.'] },
  { group: 'Pay', q: 'A guard says their pay is wrong.', a: ['They open the payslip in the app and tap **Report a concern**. Payroll answers in **Requests** → **Payroll concerns**, and the guard reads the answer in the app.'] },
  { group: 'Pay', q: 'Can we keep using our own payroll spreadsheet?', a: ['Yes. On a cutoff, **Import the payroll file**. **Download the template** to see the columns; columns are matched by their names, and rows with a problem are listed before anything is saved.'] },
  { group: 'Pay', q: 'Is pay held until a client confirms the duties?', a: ['Never. A client has two days to confirm or dispute; no answer counts as confirmed.'], client: true },

  // leave and certificates
  { group: 'Leave and certificates', q: 'How does leave approval work?', a: ['The guard files it in the app. The detachment commander endorses it and names a reliever. HR approves or declines it in **Requests** → **Leave**. The guard is told at each step.'] },
  { group: 'Leave and certificates', q: 'How fast must a certificate of employment be issued?', a: ['Within three days of the request, as DOLE requires. Each request shows its due date, and a late one is marked **Overdue** and counted on the dashboard.'] },
  { group: 'Leave and certificates', q: 'How can a bank check a certificate?', a: ['They scan its QR code, or type its code on the website\'s **Check a certificate** page. It says whether the certificate is genuine and has not been withdrawn.'] },

  // clients
  { group: 'Clients', q: 'How do I give a client a login?', a: ['**Posts and clients** → **Clients** → **Portal access**, then the person\'s name and email, and **Invite to the client portal**. Give them the code; they use **Set up your account**. You can **Turn off** a login at any time.'] },
  { group: 'Clients', q: 'What can clients see?', a: ['Their own posts, the guards on duty, attendance times (no photos or locations), cutoffs to confirm, and their own reports and requests. Never pay, addresses, government numbers or discipline records.'] },
  { group: 'Clients', q: 'A client disputed a duty. What now?', a: ['The duty shows as disputed in the cutoff, with the client\'s reason. Look into it, then decide whether it counts.'] },

  // discipline
  { group: 'Discipline', q: 'What does due process look like here?', a: ['A notice to explain with at least five days to answer, a hearing when the employee asks for one, then a written decision. The employee is told in the app at each step, and each step is dated in the case.'] },
  { group: 'Discipline', q: 'Does Claude decide cases or verify licenses?', a: ['No. Claude reads: the Code of Discipline into proposed rules, and license photos into numbers and dates. It can suggest the matching rule for a case. HR approves, verifies and decides everything.'] },
  { group: 'Discipline', q: 'Who can see government numbers?', a: ['HR and payroll, on the **Government numbers** tab. They stay hidden until someone clicks **Show the numbers**, and each time is recorded in the audit log. Guards see their own in the app.'] },

  // the app
  { group: 'The app', q: 'Can someone else open a guard\'s app on a shared phone?', a: ['Not if the guard turns on **Lock the app** (More → **Account**): the app then asks for the fingerprint, face or phone PIN when it opens.'] },
  { group: 'The app', q: 'Is there a dark mode?', a: ['Yes. It follows the phone, or the guard chooses light or dark in More → **Account**.'] },
  { group: 'The app', q: 'A guard changed their mobile number.', a: ['They send it from the app (More → **Change my details**). HR applies it in **Requests** → **Contact detail changes**.'] },

  // for clients only (the client portal's Help)
  { group: 'Using the client portal', q: 'What do we see here?', a: ['Your own posts, the guards on duty and since when, attendance by day, cutoffs to confirm, and the incident reports and requests you send. Bannuar keeps pay, addresses, government numbers, photos and locations to itself.'], clientOnly: true },
  { group: 'Using the client portal', q: 'What if we do not answer a cutoff in two days?', a: ['The duties count as confirmed. You can still report a problem as an incident.'], clientOnly: true },
  { group: 'Using the client portal', q: 'There is an emergency at a post.', a: ['Call the detachment commander at the post. Reports and requests here go to Bannuar\'s office.'], clientOnly: true },
  { group: 'Using the client portal', q: 'Can more people from our company have a login?', a: ['Yes. Ask Bannuar\'s operations team; they send each person their own invitation.'], clientOnly: true },
  { group: 'Using the client portal', q: 'How do we put the portal on the tablet\'s home screen?', a: ['Open the portal in the tablet\'s browser and choose **Add to Home Screen**. It then opens full screen, like an app.'], clientOnly: true },
];
