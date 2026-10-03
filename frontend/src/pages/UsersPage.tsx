import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, type ApiError } from '../lib/api';
import { fmtCompact, fmtDate } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Modal,
  QuotaBar,
  Spinner,
} from '../components/ui';
import type { AllocationView, UserListRow } from '../lib/types';

export default function UsersPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [allocTarget, setAllocTarget] = useState<AllocationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ raw: string; username: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<UserListRow[]>('/api/users'),
  });

  const { data: accounts } = useQuery({
    queryKey: ['mimo-accounts'],
    queryFn: () => apiGet<import('../lib/types').MimoAccountView[]>('/api/mimo/accounts'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['allocation'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const fail = (err: unknown) => setError((err as ApiError).message ?? 'Action failed');

  const toggle = useMutation({
    mutationFn: (p: { id: string; enable: boolean }) =>
      apiPost(`/api/users/${p.id}/${p.enable ? 'enable' : 'disable'}`),
    onSuccess: invalidate,
    onError: fail,
  });

  const rotateKey = useMutation({
    mutationFn: (id: string) => apiPost<{ raw: string }>(`/api/users/${id}/api-key`, { reset: 'true' }),
    onSuccess: (res) => {
      setNewKey({ raw: res.raw, username: 'user' });
      invalidate();
    },
    onError: fail,
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/users/${id}/api-key`),
    onSuccess: invalidate,
    onError: fail,
  });

  const updateAlloc = useMutation({
    mutationFn: (p: { id: string; totalTokens: number }) =>
      apiPost('/api/allocation', {
        userId: p.id,
        totalTokens: p.totalTokens,
        reason: 'admin adjustment',
      }),
    onSuccess: () => {
      setAllocTarget(null);
      invalidate();
    },
    onError: fail,
  });

  if (isLoading) return <Spinner label="Loading users" />;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">USERS</h1>
        <Button onClick={() => setCreateOpen(true)}>+ CREATE USER</Button>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      <Card accent="blue">
        <div className="overflow-x-auto">
          <table className="nb-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Akun</th>
                <th>Allocation</th>
                <th>Used</th>
                <th>Remaining</th>
                <th>Usage %</th>
                <th>Status</th>
                <th>Tenggat</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => {
                const a = row.allocation;
                const total = a?.totalTokens ?? 0;
                const used = a?.usedTokens ?? 0;
                const remaining = Math.max(0, total - used - (a?.reservedTokens ?? 0));
                const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
                const account = row.user.accountLabel;
                return (
                  <tr key={row.user.id}>
                    <td className="font-bold">{row.user.username}</td>
                    <td className="nb-mono">{row.user.email}</td>
                    <td className="nb-mono text-xs">{account ?? '—'}</td>
                    <td className="nb-mono">{fmtCompact(total)}</td>
                    <td className="nb-mono">{fmtCompact(used)}</td>
                    <td className="nb-mono">{fmtCompact(remaining)}</td>
                    <td className="w-40">
                      <QuotaBar percent={pct} />
                    </td>
                    <td>
                      <Badge tone={row.user.status === 'active' ? 'ok' : 'error'}>
                        {row.user.status}
                      </Badge>
                    </td>
                    <td className="nb-mono text-xs">
                      {row.user.expiresAt ? fmtDate(row.user.expiresAt) : '—'}
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() =>
                            toggle.mutate({ id: row.user.id, enable: row.user.status !== 'active' })
                          }
                        >
                          {row.user.status === 'active' ? 'DISABLE' : 'ENABLE'}
                        </Button>
                        <Button
                          variant="blue"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => setAllocTarget({ ...row.user, ...mapAlloc(row) })}
                        >
                          ALLOC
                        </Button>
                        <Button
                          variant="purple"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => rotateKey.mutate(row.user.id)}
                        >
                          RESET KEY
                        </Button>
                        <Button
                          variant="danger"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => revokeKey.mutate(row.user.id)}
                        >
                          REVOKE
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserModal
        open={createOpen}
        accounts={accounts ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          if (result?.apiKey) {
            setNewKey({ raw: result.apiKey.raw, username: result.user.username });
          }
          setCreateOpen(false);
          invalidate();
        }}
        onError={setError}
      />

      <AllocModal
        target={allocTarget}
        onClose={() => setAllocTarget(null)}
        onSave={(total) => updateAlloc.mutate({ id: allocTarget!.userId, totalTokens: total })}
        pending={updateAlloc.isPending}
      />

      <Modal open={newKey !== null} title="👤 API KEY DIBUAT" onClose={() => setNewKey(null)}>
        <p className="text-sm font-semibold mb-1">
          Key untuk <span className="nb-mono">{newKey?.username}</span> — disalin sekali, tidak
          ditampilkan lagi.
        </p>
        <code className="block nb-mono border-[3px] border-ink rounded-md p-3 bg-neo-green break-all">
          {newKey?.raw}
        </code>
        <Button className="w-full mt-4" onClick={() => setNewKey(null)}>
          DONE
        </Button>
      </Modal>
    </div>
  );
}

function mapAlloc(row: UserListRow) {
  return {
    userId: row.user.id,
    username: row.user.username,
    email: row.user.email,
    status: row.user.status,
    sharedPool: row.user.sharedPool,
    accountId: null,
    totalTokens: row.allocation?.totalTokens ?? 0,
    usedTokens: row.allocation?.usedTokens ?? 0,
    reservedTokens: row.allocation?.reservedTokens ?? 0,
    remainingTokens: 0,
    usagePercent: 0,
    lastRequestAt: row.user.lastRequestAt,
  } satisfies AllocationView;
}

function CreateUserModal({
  open,
  accounts,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  accounts: import('../lib/types').MimoAccountView[];
  onClose: () => void;
  onCreated: (result?: { apiKey?: { raw: string }; user: { username: string } }) => void;
  onError: (m: string) => void;
}) {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    accountId: '',
    totalTokens: '',
    expiresAt: '',
  });

  const selectedAccount = accounts.find((a) => a.id === form.accountId) ?? null;

  const { data: sharePreview } = useQuery({
    queryKey: ['auto-share', form.accountId],
    queryFn: () =>
      apiPost<{ perUser: number; pool: number; currentUsers: number }>(
        `/api/mimo/accounts/${form.accountId}/auto-share`,
        { count: 1 },
      ),
    enabled: form.accountId !== '' && form.totalTokens === '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<{
        user: { username: string };
        apiKey?: { raw: string };
        allocation: { totalTokens: number };
        autoShared: boolean;
      }>('/api/users', {
        username: form.username,
        email: form.email,
        password: form.password,
        accountId: form.accountId || null,
        totalTokens: form.totalTokens === '' ? undefined : Number(form.totalTokens),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      setForm({ username: '', email: '', password: '', accountId: '', totalTokens: '', expiresAt: '' });
      onCreated(res);
    },
    onError: (err: unknown) => onError((err as ApiError).message ?? 'Create failed'),
  });

  return (
    <Modal open={open} title="CREATE USER — AUTO SPLIT" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Username">
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            minLength={3}
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
        </Field>
        <Field label="Akun Mimo / Xiaomi">
          <select
            className="nb-input w-full"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            required
          >
            <option value="">— pilih akun —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.plan ?? 'no plan'} · sisa {fmtCompact(a.remainingQuota)}
              </option>
            ))}
          </select>
        </Field>

        {selectedAccount && form.totalTokens === '' ? (
          <div className="text-xs font-bold border-2 border-ink rounded p-2 bg-neo-purple/40 space-y-1">
            <p>⚡ ALLOCATION OTOMATIS:</p>
            {sharePreview ? (
              <>
                <p>
                  Pool {fmtCompact(sharePreview.pool)} ÷ ({sharePreview.currentUsers} user + 1 baru)
                </p>
                <p className="nb-mono text-sm">
                  = {fmtCompact(sharePreview.perUser)} tokens / user
                </p>
              </>
            ) : (
              <p className="nb-mono">menghitung…</p>
            )}
          </div>
        ) : null}

        <Field label="Override allocation (kosongkan = otomatis)">
          <Input
            type="number"
            min={0}
            value={form.totalTokens}
            onChange={(e) => setForm({ ...form, totalTokens: e.target.value })}
            placeholder="kosong = split otomatis"
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
          API key dibuat otomatis dan ditampilkan sekali setelah user dibuat. Tenggat kosong =
          ikut tenggat akun.
        </p>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'CREATING…' : 'CREATE + BAGI KUOTA →'}
        </Button>
      </form>
    </Modal>
  );
}

function AllocModal({
  target,
  onClose,
  onSave,
  pending,
}: {
  target: AllocationView | null;
  onClose: () => void;
  onSave: (total: number) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  return (
    <Modal
      open={target !== null}
      title={`ALLOCATION — ${target?.username ?? ''}`}
      onClose={() => {
        setValue('');
        setTouched(false);
        onClose();
      }}
    >
      {target ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Number(value) < target.usedTokens) return;
            onSave(Number(value));
          }}
        >
          <dl className="text-sm font-semibold space-y-1">
            <div className="flex justify-between">
              <dt className="opacity-70">Current total</dt>
              <dd className="nb-mono">{fmtCompact(target.totalTokens)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="opacity-70">Used (cannot go below)</dt>
              <dd className="nb-mono">{fmtCompact(target.usedTokens)}</dd>
            </div>
          </dl>
          <Field label="New allocation (tokens)">
            <Input
              type="number"
              min={target.usedTokens}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={String(target.totalTokens)}
              required
            />
          </Field>
          {touched && Number(value) < target.usedTokens ? (
            <ErrorBox message={`Allocation cannot be below used tokens (${target.usedTokens})`} />
          ) : null}
          <p className="text-xs font-semibold opacity-70">
            Historical usage is preserved — only the total moves, and the change lands in
            allocation_history + audit log.
          </p>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'SAVING…' : 'SAVE ALLOCATION →'}
          </Button>
        </form>
      ) : null}
    </Modal>
  );
}
