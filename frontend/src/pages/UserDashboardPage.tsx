import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { blockBar, fmtCompact, fmtDate, fmtInt } from '../lib/format';
import { Badge, Card, ErrorBox, QuotaBar, Spinner, StatBlock } from '../components/ui';
import type { MeResponse } from '../lib/types';

export default function UserDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeResponse>('/api/me'),
    refetchInterval: 15_000,
  });

  if (isLoading) return <Spinner label="Loading your dashboard" />;
  if (error || !data) return <ErrorBox message={(error as Error)?.message ?? 'Failed to load'} />;

  const { allocation } = data;
  const expired = data.user.expiresAt !== null && new Date(data.user.expiresAt).getTime() <= Date.now();

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">MY ALLOCATION</h1>
        <div className="flex items-center gap-2">
          {data.account ? (
            <Badge tone="purple">{data.account.label} · {data.account.plan ?? 'no plan'}</Badge>
          ) : null}
          {expired ? (
            <Badge tone="error">AKSES KADALUARSA</Badge>
          ) : allocation.exhausted ? (
            <Badge tone="error">QUOTA EXHAUSTED</Badge>
          ) : (
            <Badge tone="ok">{allocation.remainingPercent}% REMAINING</Badge>
          )}
        </div>
      </div>

      {expired ? (
        <div className="nb-card bg-neo-red p-6 mb-4 text-center">
          <div className="nb-title text-xl">MASA AKTIF BERAKHIR</div>
          <div className="nb-title text-sm mt-2">{fmtDate(data.user.expiresAt)}</div>
          <p className="text-sm font-semibold mt-2">
            API /v1/chat/completions ditolak dengan kode USER_EXPIRED. Hubungi admin untuk perpanjangan.
          </p>
        </div>
      ) : null}

      {allocation.exhausted ? (
        <div className="nb-card bg-neo-red p-6 mb-4 text-center">
          <div className="nb-title text-xl">QUOTA EXHAUSTED</div>
          <div className="nb-title text-3xl mt-2">0 TOKENS REMAINING</div>
          <div className="nb-title text-sm mt-2">API ACCESS LOCKED</div>
          <p className="text-sm font-semibold mt-2">
            New /v1/chat/completions requests are rejected with code QUOTA_EXCEEDED. Ask your admin
            for more allocation.
          </p>
        </div>
      ) : (
        <Card title="Quota" accent="yellow" className="mb-4">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBlock label="ALLOCATION" value={fmtCompact(allocation.total)} sub={fmtInt(allocation.total)} />
            <StatBlock label="USED" value={fmtCompact(allocation.used)} sub={fmtInt(allocation.used)} accent="red" />
            <StatBlock
              label="REMAINING"
              value={fmtCompact(allocation.remaining)}
              sub={fmtInt(allocation.remaining)}
              accent="green"
            />
          </div>
          <QuotaBar
            percent={100 - allocation.remainingPercent}
            remainingText={`${allocation.remainingPercent}% REMAINING`}
          />
          <pre className="mt-3 nb-mono border-2 border-ink rounded p-2 bg-paper overflow-x-auto">
{`MY ALLOCATION
${fmtInt(allocation.total)} TOKENS

USED
${fmtInt(allocation.used)}

REMAINING
${fmtInt(allocation.remaining)}

${allocation.remainingPercent}% REMAINING
${blockBar(100 - allocation.remainingPercent)}`}
          </pre>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <StatBlock label="REQUESTS (30D)" value={fmtInt(data.usage.requests)} accent="blue" />
        <StatBlock label="INPUT TOKENS" value={fmtCompact(data.usage.inputTokens)} accent="purple" />
        <StatBlock label="OUTPUT TOKENS" value={fmtCompact(data.usage.outputTokens)} accent="green" />
        <StatBlock
          label="RATE LIMIT"
          value={`${data.rate?.requestsPerMinute ?? 60}/min`}
          sub={`${data.rate?.requestsPerHour ?? 1000}/hour`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="API keys" accent="purple">
          {data.apiKeys.length === 0 ? (
            <p className="text-sm font-semibold opacity-70">
              No API key yet — create one on the API Keys page.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.apiKeys.map((k) => (
                <li key={k.id} className="border-2 border-ink rounded-md p-2 flex items-center gap-2 flex-wrap">
                  <code className="nb-mono font-bold break-all">{k.masked}</code>
                  <Badge tone={k.status === 'active' ? 'ok' : 'error'}>{k.status}</Badge>
                  <span className="ml-auto nb-mono opacity-70">{fmtDate(k.lastUsedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Available models" accent="blue">
          {data.models.length === 0 ? (
            <p className="text-sm font-semibold opacity-70">No models synced yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.models.map((m) => (
                <span key={m} className="nb-badge bg-white">{m}</span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Recent requests" accent="green">
          <div className="overflow-x-auto">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Model</th>
                  <th>Mode</th>
                  <th>HTTP</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="nb-mono">{fmtDate(r.createdAt)}</td>
                    <td className="nb-mono">{r.model ?? '—'}</td>
                    <td>{r.stream ? 'SSE' : 'JSON'}</td>
                    <td>
                      <Badge tone={r.httpStatus && r.httpStatus < 400 ? 'ok' : 'error'}>
                        {r.httpStatus ?? '—'}
                      </Badge>
                    </td>
                    <td className="nb-mono">{r.durationMs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
