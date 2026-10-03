import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { Card, Spinner } from '../components/ui';
import type { GatewaySettings } from '../lib/types';

export default function DocsPage() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<GatewaySettings>('/api/settings'),
  });

  const base = data?.gatewayUrl ?? window.location.origin;

  return (
    <div>
      <h1 className="nb-title text-2xl mb-4">API DOCUMENTATION</h1>
      {!data ? <Spinner label="Loading gateway URL" /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Chat completions (OpenAI-compatible)" accent="yellow">
          <pre className="nb-mono border-2 border-ink rounded p-3 bg-paper overflow-x-auto whitespace-pre-wrap">
{`POST ${base}/v1/chat/completions
Authorization: Bearer gw_live_xxxxxxxxx
Content-Type: application/json

{
  "model": "mimo-v2",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}`}
          </pre>
        </Card>

        <Card title="Models" accent="blue">
          <pre className="nb-mono border-2 border-ink rounded p-3 bg-paper overflow-x-auto whitespace-pre-wrap">
{`GET ${base}/v1/models
Authorization: Bearer gw_live_xxxxxxxxx

→ { "object": "list", "data": [...] }`}
          </pre>
        </Card>

        <Card title="curl example" accent="green" className="lg:col-span-2">
          <pre className="nb-mono border-2 border-ink rounded p-3 bg-paper overflow-x-auto whitespace-pre-wrap">
{`curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer gw_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"mimo-v2","messages":[{"role":"user","content":"Hello"}],"stream":false}'`}
          </pre>
        </Card>

        <Card title="Error format" accent="red" className="lg:col-span-2">
          <pre className="nb-mono border-2 border-ink rounded p-3 bg-paper overflow-x-auto">
{`{
  "error": {
    "message": "Quota exhausted",
    "type": "quota_exceeded",
    "code": "QUOTA_EXCEEDED"
  }
}`}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              'INVALID_API_KEY',
              'USER_DISABLED',
              'QUOTA_EXCEEDED',
              'RATE_LIMITED',
              'MIMO_UNAVAILABLE',
              'MIMO_AUTH_ERROR',
              'MODEL_NOT_FOUND',
              'UPSTREAM_ERROR',
              'REQUEST_TIMEOUT',
            ].map((c) => (
              <span key={c} className="nb-badge bg-white">{c}</span>
            ))}
          </div>
        </Card>

        <Card title="Quota lifecycle" accent="purple" className="lg:col-span-2">
          <pre className="nb-mono border-2 border-ink rounded p-3 bg-paper overflow-x-auto whitespace-pre-wrap">
{`reserve()      → atomic budget check + reservation (Redis Lua)
request()      → proxied to Mimo, SSE streamed through unchanged
finalize()     → commit actual usage (official when reported,
                 tokenizer estimate otherwise), refund the rest
release()      → on failure, the reservation is returned in full

Remaining can never go negative: two overlapping requests cannot
both pass the same remaining budget.`}
          </pre>
        </Card>
      </div>
    </div>
  );
}
