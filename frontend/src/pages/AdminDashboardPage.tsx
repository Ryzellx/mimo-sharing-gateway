import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { blockBar, fmtCompact, fmtDate, fmtInt } from '../lib/format';
import { Badge, Card, ErrorBox, QuotaBar, Spinner, StatBlock } from '../components/ui';
import { SyncStrip } from '../components/Shell';
import type { DashboardData } from '../lib/types';

export default function AdminDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardData>('/api/dashboard'),
    refetchInterval: 15_000,
  });

  if (isLoading) return <Spinner label="Loading dashboard" />;
  if (error || !data) return <ErrorBox message={(error as Error)?.message ?? 'Failed to load'} />;

  const used = data.quota.used;
  const total = data.quota.total;

  return (
    <div>
      <SyncStrip />

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">DASHBOARD</h1>
        <div className="flex gap-2 flex-wrap">
          <Badge tone={data.system.status === 'healthy' ? 'ok' : 'warn'}>{data.system.status}</Badge>
          <Badge
            tone={
              data.system.mimoConnection === 'online'
                ? 'ok'
                : data.system.mimoConnection === 'upstream_error'
                  ? 'error'
                  : 'warn'
            }
          >
            MIMO {data.system.mimoConnection}
          </Badge>
          <Badge tone="info">MODE {data.system.quotaMode}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card title="Mimo Quota" accent="yellow" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBlock label="TOTAL QUOTA" value={fmtCompact(data.quota.total)} sub={fmtInt(total)} />
            <StatBlock label="USED" value={fmtCompact(used)} sub={fmtInt(used)} accent="red" />
            <StatBlock
              label="REMAINING"
              value={fmtCompact(data.quota.remaining)}
              sub={fmtInt(data.quota.remaining)}
              accent="green"
            />
          </div>
          <QuotaBar
            percent={data.quota.usagePercent}
            remainingText={`${fmtCompact(data.quota.remaining)} LEFT`}
          />
          <pre className="mt-3 nb-mono border-2 border-ink rounded p-2 bg-paper overflow-x-auto">
{`TOTAL QUOTA  ${fmtInt(total)}
USED         ${fmtInt(used)}
REMAINING    ${fmtInt(data.quota.remaining)}
USAGE        ${blockBar(data.quota.usagePercent)}`}
          </pre>
        </Card>

        <Card title="Plan & System" accent="purple">
          <dl className="space-y-2 text-sm font-semibold">
            <div className="flex justify-between">
              <dt className="opacity-70">Mimo plan</dt>
              <dd className="nb-mono font-bold">{data.plan ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="opacity-70">Accounts</dt>
              <dd className="nb-mono font-bold">{data.accounts.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="opacity-70">Last sync</dt>
              <dd className="nb-mono font-bold">{fmtDate(data.system.syncedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="opacity-70">Allocated</dt>
              <dd className="nb-mono font-bold">{fmtCompact(data.allocation.totalAllocated)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <StatBlock label="USERS" value={fmtInt(data.users.total)} accent="blue" />
        <StatBlock label="REQUESTS TODAY" value={fmtInt(data.requests.today)} accent="purple" />
        <StatBlock label="TOKENS TODAY" value={fmtCompact(data.usage.today)} accent="green" />
        <StatBlock label="TOKENS THIS MONTH" value={fmtCompact(data.usage.month)} accent="yellow" />
      </div>

      <Card title="Mimo Accounts" accent="blue">
        {data.accounts.length === 0 ? (
          <p className="text-sm font-semibold opacity-70">
            No Mimo account yet — add one on the Mimo Accounts page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Token</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Used</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a: DashboardData['accounts'][number]) => (
                  <tr key={a.id}>
                    <td className="font-bold">{a.label}</td>
                    <td className="nb-mono">{a.tokenMasked}</td>
                    <td>
                      <Badge tone={a.status === 'active' ? 'ok' : 'error'}>{a.status}</Badge>
                    </td>
                    <td className="nb-mono">{fmtCompact(a.totalQuota)}</td>
                    <td className="nb-mono">{fmtCompact(a.usedQuota)}</td>
                    <td className="nb-mono">{fmtCompact(a.remainingQuota)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
