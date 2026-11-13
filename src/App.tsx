import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import { Loading } from './ui/kit';
import Shell from './layout/Shell';
import { SignIn, SetupAccount, ForgotPassword, ResetPassword, ChangePassword, NotConfigured, NoAccess } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Posts from './pages/Posts';
import PostDetail from './pages/PostDetail';
import Requests from './pages/Requests';
import Attendance from './pages/Attendance';
import Discipline from './pages/Discipline';
import Announcements from './pages/Announcements';
import Payroll from './pages/Payroll';
import PayrollPeriod from './pages/PayrollPeriod';
import ThirteenthMonth from './pages/ThirteenthMonth';
import Recruitment from './pages/Recruitment';
import Inquiries from './pages/Inquiries';
import Compliance from './pages/Compliance';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

function Protected({ children }: { children: ReactNode }) {
  const { ready, session, access, can, recovering } = useAuth();
  const location = useLocation();
  if (!configured) return <NotConfigured />;
  if (!ready) return <Loading what="Opening the portal" />;
  if (recovering) return <Navigate to="/reset-password" replace />;
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!access) return <Loading what="Checking your access" />;
  if (access.must_change_password) return <ChangePassword forced />;
  if (!can.staff) return <NoAccess />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  { path: '/setup', element: <SetupAccount /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/',
    element: (
      <Protected>
        <Shell />
      </Protected>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'employees', element: <Employees /> },
      { path: 'employees/:id', element: <EmployeeDetail /> },
      { path: 'posts', element: <Posts /> },
      { path: 'posts/:id', element: <PostDetail /> },
      { path: 'requests', element: <Requests /> },
      { path: 'attendance', element: <Attendance /> },
      { path: 'discipline', element: <Discipline /> },
      { path: 'announcements', element: <Announcements /> },
      { path: 'payroll', element: <Payroll /> },
      { path: 'payroll/13th-month', element: <ThirteenthMonth /> },
      { path: 'payroll/:id', element: <PayrollPeriod /> },
      { path: 'recruitment', element: <Recruitment /> },
      { path: 'inquiries', element: <Inquiries /> },
      { path: 'compliance', element: <Compliance /> },
      { path: 'users', element: <Users /> },
      { path: 'audit', element: <AuditLog /> },
      { path: 'settings', element: <Settings /> },
      { path: 'account', element: <ChangePassword /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
