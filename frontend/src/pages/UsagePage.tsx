import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet } from '../lib/api';
import { fmtCompact, fmtDate, fmtInt } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Select, Spinner, StatBlock } from '../components/ui';
import type { RequestLogRow, UsageResponse } from '../lib/types';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export default function UsagePage() {
  const [range, setRange] = useState('7d');
  const [model, setModel] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['usage', range, model],
    queryFn: () =>
      apiGet<UsageResponse>(
        `/api/usage?range=${range}${model ? `&model=${encodeURIComponent(model)}` : ''}`,
      ),
    refetchInterval: 30_000,
  });

  const requests = useQuery({
    queryKey: ['requests', range],
    queryFn: () => apiGet<RequestLogRow[]>(`/api/requests?range=${range}&limit=25`),
    refetchInterval: 30_000,
  });

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">USAGE</h1>
        <div className="flex gap-2 flex-wrap">
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="!w-auto">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Select value={model} onChange={(e) => setModel(e.target.value)} className="!w-auto">
            <option value="">All models</option>
            {(data?.byModel ?? []).map((m) => (
              <option key={m.model} value={m.model}>
                {m.model}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? <ErrorBox message={(error as Error).message} /> : null}
      {isLoading ? <Spinner label="Loading usage" /> : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
            <StatBlock label="REQUESTS" value={fmtInt(data.totals.requests)} accent="blue" />
            <StatBlock label="INPUT TOKENS" value={fmtCompact(data.totals.inputTokens)} accent="purple" />
            <StatBlock label="OUTPUT TOKENS" value={fmtCompact(data.totals.outputTokens)} accent="green" />
            <StatBlock label="TOTAL TOKENS" value={fmtCompact(data.totals.totalTokens)} accent="yellow" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            <Card title="Tokens per day" accent="purple">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.byDay}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#111" strokeOpacity={0.2} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fontWeight: 700 }} />
                    <YAxis tick={{ fontSize: 11, fontWeight: 700 }} tickFormatter={(v) => fmtCompact(Number(v))} />
                    <Tooltip contentStyle={{ border: '3px solid #111', borderRadius: 8, fontWeight: 700 }} />
                    <Legend />
                    <Line type="monotone" dataKey="totalTokens" name="Tokens" stroke="#111" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Tokens per model" accent="blue">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...data.byModel].reverse()}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#111" strokeOpacity={0.2} />
                    <XAxis dataKey="model" tick={{ fontSize: 11, fontWeight: 700 }} />
                    <YAxis tick={{ fontSize: 11, fontWeight: 700 }} tickFormatter={(v) => fmtCompact(Number(v))} />
                    <Tooltip contentStyle={{ border: '3px solid #111', borderRadius: 8, fontWeight: 700 }} />
                    <Legend />
                    <Bar dataKey="totalTokens" name="Tokens" fill="#A78BFA" stroke="#111" strokeWidth={2} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Usage log" accent="green">
            {data.rows.length === 0 ? (
              <EmptyState title="No usage yet" hint="Requests through /v1/chat/completions land here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="nb-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Model</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Total</th>
                      <th>Source</th>
                      <th>ms</th>
                      <th>HTTP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="nb-mono">{fmtDate(r.createdAt)}</td>
                        <td className="font-bold">{r.username ?? '—'}</td>
                        <td className="nb-mono">{r.model}</td>
                        <td className="nb-mono">{fmtInt(r.promptTokens)}</td>
                        <td className="nb-mono">{fmtInt(r.completionTokens)}</td>
                        <td className="nb-mono font-bold">{fmtInt(r.totalTokens)}</td>
                        <td>
                          <Badge tone={r.usageSource === 'official' ? 'ok' : 'warn'}>
                            {r.usageSource}
                          </Badge>
                        </td>
                        <td className="nb-mono">{r.durationMs ?? '—'}</td>
                        <td className="nb-mono">{r.httpStatus ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="mt-4">
            <Card title="Recent requests" accent="yellow">
              <div className="overflow-x-auto">
                <table className="nb-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Model</th>
                      <th>Stream</th>
                      <th>HTTP</th>
                      <th>Error</th>
                      <th>ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(requests.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className="nb-mono">{fmtDate(r.createdAt)}</td>
                        <td className="nb-mono">{r.model ?? '—'}</td>
                        <td>{r.stream ? 'SSE' : 'JSON'}</td>
                        <td>
                          <Badge tone={r.httpStatus && r.httpStatus < 400 ? 'ok' : 'error'}>
                            {r.httpStatus ?? '—'}
                          </Badge>
                        </td>
                        <td className="nb-mono">{r.errorCode ?? '—'}</td>
                        <td className="nb-mono">{r.durationMs ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
