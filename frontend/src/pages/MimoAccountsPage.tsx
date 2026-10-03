import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, type ApiError } from '../lib/api';
import { fmtCompact, fmtDate, fmtInt } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  Spinner,
} from '../components/ui';
import type { AccountDetail, DetectResult, MimoAccountView, ReconciliationRow } from '../lib/types';

export default function MimoAccountsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; payload: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', baseUrl: '', token: '', expiresAt: '' });
  const [detect, setDetect] = useState<DetectResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mimo-accounts'],
    queryFn: () => apiGet<MimoAccountView[]>('/api/mimo/accounts'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['mimo-accounts'] });
    void qc.invalidateQueries({ queryKey: ['mimo-account-detail'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['reconciliation'] });
  };

  const fail = (err: unknown) => {
    setError((err as ApiError).message ?? 'Action failed');
    setDetect(null);
  };

  const add = useMutation({
    mutationFn: () =>
      apiPost<{ account: MimoAccountView; detect: DetectResult | null }>('/api/mimo/accounts', {
        label: form.label,
        baseUrl: form.baseUrl,
        token: form.token,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }),
    onSuccess: (res) => {
      setDetect(res.detect);
      setForm({ label: '', baseUrl: '', token: '', expiresAt: '' });
      setAddOpen(false);
      invalidate();
    },
    onError: fail,
  });

  const redetect = useMutation({
    mutationFn: (id: string) => apiPost<{ detect: DetectResult }>(`/api/mimo/accounts/${id}/redetect`),
    onSuccess: (_res, id) => {
      invalidate();
      setExpanded(id);
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      apiDelete(`/api/mimo/accounts/${id}/users/${userId}`),
    onSuccess: invalidate,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/mimo/accounts/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });

  const test = useMutation({
    mutationFn: (id: string) => apiPost<unknown>(`/api/mimo/accounts/${id}/test`),
    onSuccess: (res, id) => setTestResult({ id, payload: JSON.stringify(res, null, 2) }),
    onError: fail,
  });

  const sync = useMutation({
    mutationFn: (id: string) => apiPost<unknown>(`/api/mimo/accounts/${id}/sync`),
    onSuccess: invalidate,
    onError: fail,
  });

  if (isLoading) return <Spinner label="Loading Mimo accounts" />;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">AKUN MIMO / XIAOMI</h1>
        <Button onClick={() => setAddOpen(true)}>+ TAMBAH AKUN</Button>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(data ?? []).map((a) => (
          <Card key={a.id} title={a.label} accent={a.status === 'active' ? 'green' : 'red'}>
            <dl className="space-y-2 text-sm font-semibold">
              <div className="flex justify-between gap-2">
                <dt className="opacity-70">Token</dt>
                <dd className="nb-mono break-all text-right">{a.tokenMasked}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-70">Base URL</dt>
                <dd className="nb-mono break-all text-right">{a.baseUrl}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-70">Plan</dt>
                <dd className="nb-mono">{a.plan ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-70">Total kuota</dt>
                <dd className="nb-mono">{fmtInt(a.totalQuota)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-70">Dipakai / Sisa</dt>
                <dd className="nb-mono">
                  {fmtCompact(a.usedQuota)} / {fmtCompact(a.remainingQuota)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-70">Reset kuota</dt>
                <dd className="nb-mono">{fmtDate(a.quotaResetAt)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="opacity-70">Tenggat akun</dt>
                <dd className="nb-mono">
                  {a.expiresAt ? fmtDate(a.expiresAt) : '—'}
                  {a.expiresAt && new Date(a.expiresAt).getTime() <= Date.now() ? (
                    <Badge tone="error" className="ml-2">EXPIRED</Badge>
                  ) : null}
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="opacity-70">Status</dt>
                <dd>
                  <Badge tone={a.status === 'active' ? 'ok' : 'error'}>{a.status}</Badge>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="opacity-70">Sync terakhir</dt>
                <dd className="flex items-center gap-2">
                  <span className="nb-mono">{fmtDate(a.lastSyncAt)}</span>
                  {a.lastSyncStatus ? (
                    <Badge tone={a.lastSyncStatus === 'ok' ? 'ok' : 'warn'}>{a.lastSyncStatus}</Badge>
                  ) : null}
                </dd>
              </div>
              {a.lastSyncError ? (
                <div className="text-xs font-bold text-black/70 border-2 border-ink rounded p-2 bg-neo-red/40">
                  {a.lastSyncError}
                </div>
              ) : null}
            </dl>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Button variant="blue" className="!text-xs" onClick={() => test.mutate(a.id)}>
                TEST
              </Button>
              <Button variant="purple" className="!text-xs" onClick={() => sync.mutate(a.id)}>
                SYNC
              </Button>
              <Button variant="green" className="!text-xs" onClick={() => redetect.mutate(a.id)}>
                RE-DETECT
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Button
                variant="yellow"
                className="!text-xs"
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
              >
                {expanded === a.id ? 'TUTUP USER ›' : 'LIHAT USER ›'}
              </Button>
              <Button variant="danger" className="!text-xs" onClick={() => remove.mutate(a.id)}>
                HAPUS
              </Button>
            </div>
            {expanded === a.id ? <AccountDetailCard accountId={a.id} onRevoke={(userId) => revoke.mutate({ id: a.id, userId })} /> : null}
          </Card>
        ))}
        {(data ?? []).length === 0 ? (
          <Card title="Belum ada akun" accent="yellow">
            <p className="text-sm font-semibold">
              Tambah akun Mimo/Xiaomi — plan, total kuota, dan daftar model akan di-detect otomatis.
              Token dienkripsi (AES-256-GCM) dan hanya tampil masked:{' '}
              <span className="nb-mono">mimo_xxxxxxxx••••••••91ab</span>.
            </p>
          </Card>
        ) : null}
      </div>

      <ReconciliationCard />

      <Modal open={addOpen} title="TAMBAH AKUN MIMO / XIAOMI" onClose={() => setAddOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Label">
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="akun-utama"
              required
            />
          </Field>
          <Field label="Base URL">
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.xiaomi.example/v1"
              required
            />
          </Field>
          <Field label="API token">
            <Input
              type="password"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder="mimo_..."
              required
              minLength={4}
            />
          </Field>
          <Field label="Tenggat (opsional)">
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </Field>
          <p className="text-xs font-semibold opacity-70">
            Simpan = auto-detect plan, total kuota, sisa kuota & daftar model. Token dienkripsi dan
            tidak pernah dikembalikan ke browser.
          </p>
          <Button type="submit" className="w-full" disabled={add.isPending}>
            {add.isPending ? 'MENDETEKSI…' : 'DETECT & SIMPAN →'}
          </Button>
        </form>
      </Modal>

      <Modal open={detect !== null} title="HASIL DETECT" onClose={() => setDetect(null)}>
        {detect ? <DetectSummary d={detect} /> : null}
        <Button className="w-full mt-3" onClick={() => setDetect(null)}>
          TUTUP
        </Button>
      </Modal>

      <Modal open={testResult !== null} title="TEST RESULT" onClose={() => setTestResult(null)}>
        <p className="text-sm font-semibold mb-2">
          Endpoint yang tidak terkonfigurasi melaporkan{' '}
          <span className="nb-mono">configured:false</span> — isi path via auto-detect / re-detect.
        </p>
        <pre className="nb-mono border-[3px] border-ink rounded-md p-3 bg-paper overflow-x-auto max-h-80">
          {testResult?.payload}
        </pre>
      </Modal>
    </div>
  );
}

function DetectSummary({ d }: { d: DetectResult }) {
  return (
    <div className="space-y-2 text-sm font-semibold">
      <div className="flex justify-between">
        <dt className="opacity-70">Status</dt>
        <dd>
          <Badge tone={d.detected ? 'ok' : 'error'}>{d.detected ? 'DETECTED' : 'NOT DETECTED'}</Badge>
        </dd>
      </div>
      {d.detected ? (
        <>
          <div className="flex justify-between">
            <dt className="opacity-70">Plan</dt>
            <dd className="nb-mono">{d.plan ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="opacity-70">Total kuota</dt>
            <dd className="nb-mono">{fmtInt(d.totalQuota)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="opacity-70">Sisa kuota</dt>
            <dd className="nb-mono">{fmtInt(d.remainingQuota)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="opacity-70">Model ditemukan</dt>
            <dd className="nb-mono">{d.models.length}</dd>
          </div>
          {d.models.length > 0 ? (
            <div className="border-2 border-ink rounded p-2 bg-paper">
              <p className="text-xs opacity-70 mb-1">MODELS:</p>
              <p className="nb-mono text-xs break-all">{d.models.map((m) => m.id).join(', ')}</p>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="opacity-70">Endpoint</dt>
            <dd className="nb-mono text-xs text-right">
              {d.modelsPath ?? '—'} · {d.usagePath ?? '—'} · {d.accountPath ?? '—'}
            </dd>
          </div>
        </>
      ) : (
        <p className="text-xs font-bold border-2 border-ink rounded p-2 bg-neo-red/40">
          Token atau base URL tidak valid, atau endpoint tidak dikenali. Akun tetap tersimpan — bisa
          di-sync manual nanti.
        </p>
      )}
    </div>
  );
}

function AccountDetailCard({
  accountId,
  onRevoke,
}: {
  accountId: string;
  onRevoke: (userId: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['mimo-account-detail', accountId],
    queryFn: () => apiGet<AccountDetail>(`/api/mimo/accounts/${accountId}/detail`),
  });

  if (isLoading) return <Spinner label="Memuat detail…" />;
  if (!data) return null;

  const sumUsed = data.allocations.reduce((a, b) => a + b.usedTokens, 0);
  const pool = data.account.remainingQuota ?? data.account.totalQuota ?? 0;

  return (
    <div className="mt-3 border-[3px] border-ink rounded-md p-3 bg-paper space-y-2">
      <p className="text-xs font-bold opacity-70">
        {data.allocations.length} USER · ALOCATED {fmtInt(data.sumAllocated)} / {fmtInt(pool)} · LOCAL
        USED {fmtInt(data.localUsed)}
      </p>
      {data.allocations.length === 0 ? (
        <p className="text-xs font-semibold opacity-60">
          Belum ada user dengan kuota dari akun ini. Split otomatis saat create user.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="nb-table !text-xs">
            <thead>
              <tr>
                <th>User</th>
                <th>Kuota</th>
                <th>Sisa</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((u) => (
                <tr key={u.userId}>
                  <td className="font-bold">{u.username}</td>
                  <td className="nb-mono">{fmtCompact(u.totalTokens)}</td>
                  <td className="nb-mono">{fmtCompact(u.remainingTokens)}</td>
                  <td>
                    <Badge tone={u.remainingTokens > 0 ? 'ok' : 'warn'}>{u.usagePercent}%</Badge>
                  </td>
                  <td>
                    <Button
                      variant="danger"
                      className="!text-[10px] !px-2 !py-1"
                      onClick={() => onRevoke(u.userId)}
                    >
                      REVOKE
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs font-semibold opacity-60">
        Sisa kuota bersama (akun − allocated):{' '}
        <span className="nb-mono">{fmtInt(Math.max(0, pool - data.sumAllocated))}</span> · total
        dipakai user {fmtCompact(sumUsed)}
      </p>
      {data.models.length > 0 ? (
        <p className="text-xs font-semibold opacity-60 break-all">
          Models ({data.models.length}): <span className="nb-mono">{data.models.map((m) => m.modelId).join(', ')}</span>
        </p>
      ) : null}
    </div>
  );
}

function ReconciliationCard() {
  const { data } = useQuery({
    queryKey: ['reconciliation'],
    queryFn: () => apiGet<ReconciliationRow[]>('/api/reconciliation'),
    refetchInterval: 30_000,
  });

  return (
    <div className="mt-4">
      <Card title="Local vs official usage" accent="yellow">
        <div className="overflow-x-auto">
          <table className="nb-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Local usage</th>
                <th>Mimo official</th>
                <th>Difference</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.accountId}>
                  <td className="font-bold">{r.label}</td>
                  <td className="nb-mono">{fmtInt(r.localUsage)}</td>
                  <td className="nb-mono">{r.configured ? fmtInt(r.officialUsage) : 'not configured'}</td>
                  <td className="nb-mono">{r.configured ? fmtInt(r.difference) : '—'}</td>
                  <td>
                    <Badge
                      tone={
                        !r.configured
                          ? 'idle'
                          : (r.difference ?? 0) === 0
                            ? 'ok'
                            : 'warn'
                      }
                    >
                      {!r.configured ? 'NO ENDPOINT' : (r.difference ?? 0) === 0 ? 'SYNCED' : 'DRIFT'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs font-semibold opacity-70 mt-3">
          Data lokal tidak pernah dihapus saat rekonsiliasi — perbedaan dicatat di
          reconciliation_logs.
        </p>
      </Card>
    </div>
  );
}