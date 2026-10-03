import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, type ApiError } from '../lib/api';
import { fmtDate } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Spinner,
} from '../components/ui';
import type { ApiKeyView } from '../lib/types';

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('default');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-keys'],
    queryFn: () => apiGet<ApiKeyView[]>('/api/me/api-keys'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['my-keys'] });
  const fail = (err: unknown) => setError((err as ApiError).message ?? 'Action failed');

  const create = useMutation({
    mutationFn: () => apiPost<{ raw: string }>('/api/me/api-keys', { name }),
    onSuccess: (res) => {
      setNewKey(res.raw);
      invalidate();
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/me/api-keys/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });

  const rotate = useMutation({
    mutationFn: (id: string) => apiPost<{ raw: string }>(`/api/me/api-keys/${id}/rotate`),
    onSuccess: (res) => {
      setNewKey(res.raw);
      invalidate();
    },
    onError: fail,
  });

  if (isLoading) return <Spinner label="Loading API keys" />;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">API KEYS</h1>
        <Badge tone="info">FORMAT gw_live_…</Badge>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      <Card title="Create key" accent="yellow" className="mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[14rem]">
            <Field label="Key name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="default" />
            </Field>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'CREATING…' : '+ CREATE API KEY'}
          </Button>
        </div>
        <p className="text-xs font-semibold opacity-70 mt-2">
          Only the SHA-256 hash is stored — the raw key is shown exactly once.
        </p>
      </Card>

      <Card title="Your keys" accent="purple">
        {!data || data.length === 0 ? (
          <EmptyState title="No keys yet" hint="Create one above to call /v1/chat/completions." />
        ) : (
          <div className="overflow-x-auto">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((k) => (
                  <tr key={k.id}>
                    <td className="font-bold">{k.name}</td>
                    <td className="nb-mono break-all">{k.masked}</td>
                    <td>
                      <Badge tone={k.status === 'active' ? 'ok' : 'error'}>{k.status}</Badge>
                    </td>
                    <td className="nb-mono">{fmtDate(k.createdAt)}</td>
                    <td className="nb-mono">{fmtDate(k.lastUsedAt)}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button
                          variant="purple"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => rotate.mutate(k.id)}
                        >
                          ROTATE
                        </Button>
                        <Button
                          variant="danger"
                          className="!px-2 !py-1 !text-xs"
                          onClick={() => revoke.mutate(k.id)}
                        >
                          REVOKE
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={newKey !== null} title="NEW API KEY" onClose={() => setNewKey(null)}>
        <p className="text-sm font-semibold mb-2">
          Copy this key now — it is shown once and never again.
        </p>
        <code className="block nb-mono border-[3px] border-ink rounded-md p-3 bg-neo-green break-all">
          {newKey}
        </code>
        <Button className="w-full mt-4" onClick={() => setNewKey(null)}>
          DONE
        </Button>
      </Modal>
    </div>
  );
}
