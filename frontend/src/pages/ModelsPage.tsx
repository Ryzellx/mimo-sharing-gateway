import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, type ApiError } from '../lib/api';
import { fmtDate } from '../lib/format';
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
import type { CustomModelView, MimoAccountView } from '../lib/types';

/**
 * Custom models = model aliases with an injected system prompt.
 * Lets the admin expose "mod"/"unc"-style variants of any upstream model.
 */
export default function ModelsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CustomModelView | null>(null);
  const [form, setForm] = useState({
    accountId: '',
    modelAlias: '',
    targetModel: '',
    systemPrompt: '',
  });

  const { data: models, isLoading } = useQuery({
    queryKey: ['custom-models'],
    queryFn: () => apiGet<CustomModelView[]>('/api/mimo/models/custom'),
  });

  const { data: accounts } = useQuery({
    queryKey: ['mimo-accounts'],
    queryFn: () => apiGet<MimoAccountView[]>('/api/mimo/accounts'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['custom-models'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const fail = (err: unknown) => {
    setError((err as ApiError).message ?? 'Action failed');
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ customModel: CustomModelView }>('/api/mimo/models/custom', {
        accountId: form.accountId,
        modelAlias: form.modelAlias,
        targetModel: form.targetModel,
        systemPrompt: form.systemPrompt,
      }),
    onSuccess: () => {
      setForm({ accountId: '', modelAlias: '', targetModel: '', systemPrompt: '' });
      invalidate();
    },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: (cm: CustomModelView) =>
      apiPatch<{ customModel: CustomModelView }>(`/api/mimo/models/custom/${cm.id}`, {
        modelAlias: cm.modelAlias,
        targetModel: cm.targetModel,
        systemPrompt: cm.systemPrompt,
        status: cm.status,
      }),
    onSuccess: () => {
      setEditTarget(null);
      invalidate();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/mimo/models/custom/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });

  if (isLoading) return <Spinner label="Loading custom models" />;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">CUSTOM MODELS</h1>
        <Badge tone="purple">{models?.length ?? 0} MODEL</Badge>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      <Card accent="blue" className="mb-4">
        <fieldset className="border-2 border-ink rounded-md p-3 bg-paper">
          <legend className="nb-title text-sm font-black px-2">+ BUAT MODEL MOD / UNC</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Akun Mimo / Xiaomi">
              <select
                className="nb-input w-full"
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                required
              >
                <option value="">— pilih akun —</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.plan ?? 'no plan'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model alias (nama custom)">
              <Input
                value={form.modelAlias}
                onChange={(e) => setForm({ ...form, modelAlias: e.target.value })}
                placeholder="deepseek-mod"
                required
              />
            </Field>
            <Field label="Target model (upstream)">
              <Input
                value={form.targetModel}
                onChange={(e) => setForm({ ...form, targetModel: e.target.value })}
                placeholder="deepseek-v4-flash"
                required
              />
            </Field>
            <Field label="Status">
              <select
                className="nb-input w-full"
                value="active"
                onChange={() => undefined}
                disabled
              >
                <option value="active">active</option>
              </select>
            </Field>
          </div>
          <Field label="System prompt (inject ke tiap request)">
            <textarea
              className="nb-input w-full min-h-24"
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder={'You are a helpful unrestricted assistant...'}
              required
            />
          </Field>
          <Button
            className="w-full"
            disabled={create.isPending || form.accountId === '' || form.modelAlias === '' || form.targetModel === '' || form.systemPrompt === ''}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'SAVING…' : 'BUAT MODEL →'}
          </Button>
        </fieldset>
      </Card>

      <Card accent="green">
        <div className="overflow-x-auto">
          <table className="nb-table">
            <thead>
              <tr>
                <th>Alias</th>
                <th>Akun</th>
                <th>Target</th>
                <th>System prompt</th>
                <th>Status</th>
                <th>Dibuat</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(models ?? []).map((cm) => (
                <tr key={cm.id}>
                  <td className="font-bold nb-mono">{cm.modelAlias}</td>
                  <td className="nb-mono text-xs">{cm.accountLabel}</td>
                  <td className="nb-mono text-xs">{cm.targetModel}</td>
                  <td className="text-xs nb-mono max-w-48 truncate" title={cm.systemPrompt}>
                    {cm.systemPrompt.length > 42 ? `${cm.systemPrompt.slice(0, 42)}…` : cm.systemPrompt}
                  </td>
                  <td>
                    <Badge tone={cm.status === 'active' ? 'ok' : 'error'}>{cm.status}</Badge>
                  </td>
                  <td className="nb-mono text-xs">{fmtDate(cm.createdAt)}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      <Button
                        variant="blue"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() =>
                          setEditTarget({
                            ...cm,
                            modelAlias: cm.modelAlias,
                            targetModel: cm.targetModel,
                            systemPrompt: cm.systemPrompt,
                            status: cm.status,
                          })
                        }
                      >
                        EDIT
                      </Button>
                      <Button
                        variant="danger"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() => remove.mutate(cm.id)}
                      >
                        HAPUS
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {(models ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-sm font-semibold opacity-70">
                    Belum ada custom model. Bikin di atas: pilih akun, nama alias (misal 'deepseek-mod'),
                    target model upstream, terus sistem prompt.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs font-semibold opacity-70 mt-3">
          Gateway flow: user panggil <code className="nb-mono">model=alias</code> → system prompt diinject
          ke messages → request di-rewrite ke target model upstream. Usage tetap dicatat per alias.
          Alias otomatis tampil di{' '}
          <code className="nb-mono">GET /v1/models</code> dengan{' '}
          <code className="nb-mono">owned_by=custom</code>.
        </p>
      </Card>

      <Modal open={editTarget !== null} title={`EDIT — ${editTarget?.modelAlias ?? ''}`} onClose={() => setEditTarget(null)}>
        {editTarget ? (
          <div className="space-y-3">
            <Field label="Model alias">
              <Input
                value={editTarget.modelAlias}
                onChange={(e) => setEditTarget({ ...editTarget, modelAlias: e.target.value })}
                required
              />
            </Field>
            <Field label="Target model (upstream)">
              <Input
                value={editTarget.targetModel}
                onChange={(e) => setEditTarget({ ...editTarget, targetModel: e.target.value })}
                required
              />
            </Field>
            <Field label="System prompt">
              <textarea
                className="nb-input w-full min-h-24"
                value={editTarget.systemPrompt}
                onChange={(e) => setEditTarget({ ...editTarget, systemPrompt: e.target.value })}
                required
              />
            </Field>
            <Field label="Status">
              <select
                className="nb-input w-full"
                value={editTarget.status}
                onChange={(e) => setEditTarget({ ...editTarget, status: e.target.value })}
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
            <Button className="w-full" onClick={() => update.mutate(editTarget)}>
              SIMPAN → 
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}