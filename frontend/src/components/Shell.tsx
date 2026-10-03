import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button } from '../components/ui';
import type { ReconciliationRow } from '../lib/types';

const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/models', label: 'Models' },
  { to: '/admin/mimo', label: 'Mimo Accounts' },
  { to: '/admin/usage', label: 'Usage' },
  { to: '/admin/settings', label: 'Settings' },
];

const USER_NAV = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/keys', label: 'API Keys' },
  { to: '/app/usage', label: 'Usage' },
  { to: '/app/docs', label: 'Docs' },
];

export function Shell() {
  const { role, username, logout } = useAuth();
  const navigate = useNavigate();
  const nav = role === 'admin' ? ADMIN_NAV : USER_NAV;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b-[4px] border-ink bg-white sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4 flex-wrap">
          <Link to={role === 'admin' ? '/admin' : '/app'} className="flex items-center gap-2">
            <span className="nb-title text-lg nb-card-flat bg-neo-yellow px-2 py-1 shadow-neo-sm -rotate-1">
              MIMO GW
            </span>
          </Link>
          <Badge tone={role === 'admin' ? 'purple' : 'info'}>{role ?? 'guest'}</Badge>
          <div className="ml-auto flex items-center gap-3">
            <span className="nb-mono font-bold hidden sm:inline">{username}</span>
            <Button
              variant="ghost"
              onClick={() => {
                logout();
                navigate('/', { replace: true });
              }}
            >
              LOG OUT
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-7xl px-2 pb-2 flex gap-1 overflow-x-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-1.5 border-[3px] border-ink rounded-md text-xs font-black uppercase tracking-wide whitespace-nowrap transition-all active:translate-y-[2px] ${
                  isActive ? 'bg-neo-purple shadow-neo-sm' : 'bg-white hover:bg-neo-yellow/40'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 mx-auto max-w-7xl w-full p-4 sm:p-6">
        <Outlet />
      </main>
      <footer className="border-t-[3px] border-ink bg-white py-3">
        <div className="mx-auto max-w-7xl px-4 nb-mono opacity-60 flex justify-between flex-wrap gap-2">
          <span>MIMO GATEWAY — quota sharing, done clean</span>
          <span>OpenAI-compatible · /v1/chat/completions</span>
        </div>
      </footer>
    </div>
  );
}

export function SyncStrip() {
  const { data } = useQuery({
    queryKey: ['reconciliation'],
    queryFn: () => apiGet<ReconciliationRow[]>('/api/reconciliation'),
    refetchInterval: 60_000,
  });

  if (!data || data.length === 0) return null;
  const problems = data.filter((r) => !r.configured || (r.difference ?? 0) !== 0);
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {problems.length === 0 ? (
        <Badge tone="ok">SYNCED</Badge>
      ) : (
        problems.map((r) => (
          <Badge key={r.accountId} tone={r.configured ? 'warn' : 'idle'}>
            {r.label}: {r.configured ? `drift ${r.difference ?? 0}` : 'quota endpoint not configured'}
          </Badge>
        ))
      )}
    </div>
  );
}
