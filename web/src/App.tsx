import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABEL } from "./auth";
import { Spinner, Icon } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Attendance from "./pages/Attendance";
import Calendar from "./pages/Calendar";
import Approvals from "./pages/Approvals";
import WeeklyReports from "./pages/WeeklyReports";
import WeeklyReminder from "./components/WeeklyReminder";
import NotificationBell from "./components/NotificationBell";
import Imports from "./pages/Imports";
import Exports from "./pages/Exports";
import Inventory from "./pages/Inventory";
import Materials from "./pages/Materials";
import Trips from "./pages/Trips";
import Users from "./pages/Users";
import Chat from "./pages/Chat";
import Meetings from "./pages/Meetings";

interface NavItem { to: string; label: string; icon: string; roles?: string[] }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Workspace", items: [
    { to: "/", label: "대시보드", icon: "dashboard" },
    { to: "/tasks", label: "업무 / 할일", icon: "task_alt" },
    { to: "/calendar", label: "일정 / 캘린더", icon: "calendar_month" },
    { to: "/attendance", label: "근태 / 출퇴근", icon: "schedule" },
    { to: "/approvals", label: "전자결재", icon: "approval" },
    { to: "/weekly", label: "주간결산 보고", icon: "event_note" },
  ]},
  { group: "Communication", items: [
    { to: "/chat", label: "단체 채팅", icon: "forum" },
    { to: "/meetings", label: "화상회의", icon: "videocam" },
  ]},
  { group: "Trade & Logistics", items: [
    { to: "/imports", label: "원료 수입현황", icon: "sailing" },
    { to: "/exports", label: "원료 수출현황", icon: "local_shipping" },
    { to: "/inventory", label: "재고관리", icon: "inventory_2" },
    { to: "/materials", label: "원료 / 분석결과", icon: "science" },
  ]},
  { group: "Admin", items: [
    { to: "/trips", label: "출장관리", icon: "flight" },
    { to: "/users", label: "직원관리", icon: "groups", roles: ["admin"] },
  ]},
];

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-primary/30 md:hidden" onClick={onClose} />}
      <aside className={`fixed left-0 top-0 z-50 flex h-screen w-[280px] flex-col border-r border-outline-variant bg-surface-container transition-transform md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-6 pb-4 pt-6">
          <NavLink to="/">
            <img src="/orca-logo.png" alt="ORCA KOREA" className="w-full max-w-[200px]" />
          </NavLink>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2 scrollbar-hide">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-4 pb-1 mono-label text-on-surface-variant opacity-60">{g.group}</div>
              {g.items.filter((i) => !i.roles || i.roles.includes(user!.role)).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={onClose}
                  className={({ isActive }) => `flex items-center gap-4 px-4 py-2.5 transition-all duration-150 ${isActive ? "bg-secondary-container font-bold text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container-highest"}`}>
                  <Icon name={i.icon} size={22} />
                  <span className="mono-label">{i.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-outline-variant p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed font-bold">
              {user!.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-primary">{user!.name}</div>
              <div className="truncate text-xs text-on-surface-variant">{ROLE_LABEL[user!.role] || user!.role} · {user!.department}</div>
            </div>
            <button onClick={logout} title="로그아웃" className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest">
              <Icon name="logout" size={20} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden md:ml-[280px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-container-low md:hidden" onClick={() => setNavOpen(true)}>
              <Icon name="menu" />
            </button>
            <div className="relative hidden sm:block">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={20} />
              <input className="h-10 w-72 border-none bg-surface-container-low pl-10 pr-4 text-sm focus:ring-2 focus:ring-secondary" placeholder="검색어를 입력하세요..." />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            {user!.role === "admin" && (
              <button onClick={() => navigate("/users")} title="제어판 (직원관리)"
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-container-low"><Icon name="settings" /></button>
            )}
            <div className="mx-2 h-8 w-px bg-outline-variant" />
            <div className="text-right">
              <p className="text-sm font-bold text-primary">{user!.name}</p>
              <p className="text-xs text-on-surface-variant">{ROLE_LABEL[user!.role] || user!.role}</p>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-hide p-4 sm:p-8">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><Spinner /></div>;
  if (!user) return <Login />;

  return (
    <Layout>
      <WeeklyReminder />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/weekly" element={<WeeklyReports />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/imports" element={<Imports />} />
        <Route path="/exports" element={<Exports />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/trips" element={<Trips />} />
        {user.role === "admin" && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
