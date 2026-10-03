import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, type ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorBox, Field, Input } from '../components/ui';

interface LoginResponse {
  token: string;
  username: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [asAdmin, setAsAdmin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const path = asAdmin ? '/api/auth/admin/login' : '/api/auth/login';
      return apiPost<LoginResponse>(path, { email, password });
    },
    onSuccess: (res) => {
      login(res.token, asAdmin ? 'admin' : 'user', res.username);
      navigate(asAdmin ? '/admin' : '/app', { replace: true });
    },
    onError: (err: unknown) => {
      setError((err as ApiError).message ?? 'Login failed');
    },
  });

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-block nb-card-flat bg-neo-yellow px-4 py-2 shadow-neo-sm -rotate-2">
            <span className="nb-title text-3xl">MIMO GATEWAY</span>
          </div>
          <p className="mt-4 text-sm font-semibold max-w-sm mx-auto">
            Split one Mimo quota into clean, enforced allocations. Reserve, stream, reconcile —
            race-free.
          </p>
        </div>

        <Card title="Sign in" accent="purple">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              mutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={asAdmin ? 'green' : 'ghost'}
                onClick={() => setAsAdmin(true)}
              >
                ADMIN
              </Button>
              <Button
                type="button"
                variant={!asAdmin ? 'green' : 'ghost'}
                onClick={() => setAsAdmin(false)}
              >
                USER
              </Button>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>
            {error ? <ErrorBox message={error} /> : null}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'SIGNING IN…' : 'SIGN IN →'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center nb-mono opacity-60">
          API keys: gw_live_… · tokens encrypted at rest · quota enforced atomically
        </p>
      </div>
    </main>
  );
}
