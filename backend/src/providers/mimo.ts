import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import type {
  AIProvider,
  ChatRequest,
  ChatResult,
  ProviderAccountInfo,
  ProviderModel,
  ProviderQuota,
  ProviderUsage,
} from './types.js';

/**
 * MimoProvider — adapter for the Mimo API.
 *
 * Only the chat-completions surface is assumed to follow the OpenAI wire
 * format (that is the contract the gateway itself exposes). Account / quota /
 * usage / model-list endpoints are treated as *integration points*: they are
 * only called when the matching *_PATH setting is configured. If a path is not
 * configured the method returns `{ configured: false }` instead of guessing an
 * endpoint, and the UI surfaces that state honestly.
 */

interface HttpResponse<T> {
  status: number;
  ok: boolean;
  data: T | null;
  text: string;
}

function notConfigured<T extends { configured: boolean }>(): T {
  return { configured: false } as T;
}

export class MimoProvider implements AIProvider {
  readonly name = 'mimo';

  constructor(
    private readonly options: {
      baseUrl?: string;
      accountPath?: string;
      usagePath?: string;
      modelsPath?: string;
      chatPath?: string;
      timeoutMs?: number;
    } = {},
  ) {}

  private get baseUrl(): string {
    return (this.options.baseUrl ?? config.env.MIMO_API_URL).replace(/\/+$/, '');
  }

  private get chatPath(): string {
    return this.options.chatPath ?? config.env.MIMO_CHAT_PATH;
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? config.env.UPSTREAM_TIMEOUT_MS;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
  }

  private async getJson<T>(path: string, token: string): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url(path), {
        method: 'GET',
        headers: this.headers(token),
        signal: controller.signal,
      });
      const text = await res.text();
      let data: T | null = null;
      try {
        data = text ? (JSON.parse(text) as T) : null;
      } catch {
        data = null;
      }
      return { status: res.status, ok: res.ok, data, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccount(token: string): Promise<ProviderAccountInfo> {
    const path = this.options.accountPath ?? config.env.MIMO_ACCOUNT_PATH;
    if (!path) return notConfigured<ProviderAccountInfo>();
    const res = await this.getJson<any>(path, token);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw errors.mimoAuthError();
      throw errors.mimoUnavailable();
    }
    return {
      configured: true,
      plan: res.data?.plan ?? null,
      status: res.data?.status ?? null,
      raw: res.data,
    };
  }

  async getPlan(token: string) {
    const account = await this.getAccount(token);
    return { configured: account.configured, plan: account.plan ?? null };
  }

  async getQuota(token: string): Promise<ProviderQuota> {
    const path = this.options.usagePath ?? config.env.MIMO_USAGE_PATH;
    if (!path) return notConfigured<ProviderQuota>();
    const res = await this.getJson<any>(path, token);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw errors.mimoAuthError();
      throw errors.mimoUnavailable();
    }
    const q = res.data?.quota ?? res.data ?? {};
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : null);
    return {
      configured: true,
      total: num(q.total_quota ?? q.total),
      used: num(q.used_quota ?? q.used),
      remaining: num(q.remaining_quota ?? q.remaining),
      resetAt: q.reset_at ?? q.reset_date ?? null,
      raw: res.data,
    };
  }

  async getUsage(token: string): Promise<ProviderUsage> {
    const quota = await this.getQuota(token);
    return {
      configured: quota.configured,
      used: quota.used ?? null,
      raw: quota.raw,
    };
  }

  async getModels(token: string): Promise<{ configured: boolean; models: ProviderModel[] }> {
    const path = this.options.modelsPath ?? config.env.MIMO_MODELS_PATH;
    if (!path) return notConfigured<{ configured: boolean; models: ProviderModel[] }>();
    const res = await this.getJson<any>(path, token);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw errors.mimoAuthError();
      throw errors.mimoUnavailable();
    }
    const list = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
    const models: ProviderModel[] = list.map((m: any) => ({
      id: String(m.id ?? m.model ?? m.name),
      ownedBy: m.owned_by ?? null,
      raw: m,
    }));
    return { configured: true, models };
  }

  async chat(
    token: string,
    request: ChatRequest,
    opts: { signal?: AbortSignal; baseUrl?: string } = {},
  ): Promise<ChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const base = (opts.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const url = `${base}${this.chatPath.startsWith('/') ? this.chatPath : `/${this.chatPath}`}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(token),
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if ((err as Error).name === 'AbortError') throw errors.requestTimeout();
      throw errors.mimoUnavailable();
    }

    const contentType = res.headers.get('content-type') ?? '';

    if (!res.ok) {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) throw errors.mimoAuthError();
      if (res.status === 404) throw errors.modelNotFound(request.model);
      throw errors.upstreamError(`Mimo returned ${res.status}: ${text.slice(0, 300)}`);
    }

    if (request.stream) {
      return {
        status: res.status,
        contentType,
        stream: res.body,
        usage: null,
      };
    }

    const text = await res.text();
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw errors.upstreamError('Mimo returned malformed JSON');
    }
    return {
      status: res.status,
      contentType,
      body,
      usage: (body as any)?.usage ?? null,
    };
  }
}

export const mimoProvider = new MimoProvider();

/** A MimoProvider bound to one account's own endpoints (path auto-detected). */
export function providerForAccount(account: {
  baseUrl: string;
  accountPath?: string | null;
  usagePath?: string | null;
  modelsPath?: string | null;
  chatPath?: string | null;
}): MimoProvider {
  return new MimoProvider({
    baseUrl: account.baseUrl,
    accountPath: account.accountPath ?? undefined,
    usagePath: account.usagePath ?? undefined,
    modelsPath: account.modelsPath ?? undefined,
    chatPath: account.chatPath ?? undefined,
  });
}
