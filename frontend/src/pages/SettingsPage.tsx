import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPatch, type ApiError } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Spinner } from '../components/ui';
import type { GatewaySettings } from '../lib/types';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<GatewaySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<GatewaySettings>('/api/settings'),
  });

  const current = form ?? data;

  const save = useMutation({
    mutationFn: (patch: Partial<GatewaySettings>) => apiPatch<GatewaySettings>('/api/settings', patch),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: unknown) => setError((err as ApiError).message ?? 'Save failed'),
  });

  if (isLoading || !current) return <Spinner label="Loading settings" />;

  const set = <K extends keyof GatewaySettings>(key: K, value: GatewaySettings[K]) => {
    setForm({ ...current, [key]: value });
    setSaved(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="nb-title text-2xl">SETTINGS</h1>
        {saved ? <Badge tone="ok">SAVED</Badge> : null}
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Gateway" accent="yellow">
          <div className="space-y-3">
            <Field label="Gateway URL">
              <Input value={current.gatewayUrl} onChange={(e) => set('gatewayUrl', e.target.value)} />
            </Field>
            <Field label="Default model">
              <Input value={current.defaultModel} onChange={(e) => set('defaultModel', e.target.value)} />
            </Field>
            <Field label="Quota behavior">
              <Select
                value={current.quotaMode}
                onChange={(e) => set('quotaMode', e.target.value as GatewaySettings['quotaMode'])}
              >
                <option value="allocation">allocation — per-user split, enforced</option>
                <option value="shared_pool">shared_pool — one shared pool (explicit opt-in)</option>
              </Select>
            </Field>
            <p className="text-xs font-semibold opacity-70">
              Shared pool is disabled by default: users only draw from their own allocation unless
              this mode is explicitly enabled.
            </p>
          </div>
        </Card>

        <Card title="Rate limits & performance" accent="purple">
          <div className="space-y-3">
            <Field label="Requests per minute (default)">
              <Input
                type="number"
                value={current.requestsPerMinute}
                onChange={(e) => set('requestsPerMinute', Number(e.target.value))}
              />
            </Field>
            <Field label="Requests per hour (default)">
              <Input
                type="number"
                value={current.requestsPerHour}
                onChange={(e) => set('requestsPerHour', Number(e.target.value))}
              />
            </Field>
            <Field label="Mimo sync interval (seconds)">
              <Input
                type="number"
                value={current.syncIntervalSeconds}
                onChange={(e) => set('syncIntervalSeconds', Number(e.target.value))}
              />
            </Field>
            <Field label="Reservation TTL (seconds)">
              <Input
                type="number"
                value={current.reservationTtlSeconds}
                onChange={(e) => set('reservationTtlSeconds', Number(e.target.value))}
              />
            </Field>
          </div>
        </Card>

        <Card title="Security & logging" accent="blue">
          <div className="space-y-3">
            <Field label="CORS origin">
              <Input value={current.corsOrigin} onChange={(e) => set('corsOrigin', e.target.value)} />
            </Field>
            <Field label="Log level">
              <Select value={current.logLevel} onChange={(e) => set('logLevel', e.target.value)}>
                {['silent', 'error', 'warn', 'info', 'debug'].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <ul className="text-xs font-semibold opacity-70 space-y-1 list-disc pl-5">
              <li>Argon2id password hashing</li>
              <li>API keys stored as SHA-256 hash only</li>
              <li>Mimo tokens AES-256-GCM encrypted at rest</li>
              <li>Audit log on every admin action</li>
            </ul>
          </div>
        </Card>

        <Card title="Admin settings" accent="green">
          <p className="text-sm font-semibold mb-3">
            Changes apply immediately and are recorded in the audit log with actor + IP.
          </p>
          <Button
            className="w-full"
            disabled={save.isPending || form === null}
            onClick={() => form && save.mutate(form)}
          >
            {save.isPending ? 'SAVING…' : form === null ? 'NO CHANGES' : 'SAVE SETTINGS →'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
