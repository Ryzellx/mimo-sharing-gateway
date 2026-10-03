export interface ProviderModel {
  id: string;
  ownedBy?: string | null;
  raw?: unknown;
}

export interface ProviderQuota {
  configured: boolean;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  resetAt?: string | null;
  raw?: unknown;
}

export interface ProviderAccountInfo {
  configured: boolean;
  plan?: string | null;
  status?: string | null;
  raw?: unknown;
}

export interface ProviderUsage {
  configured: boolean;
  used?: number | null;
  raw?: unknown;
}

export interface ChatRequest {
  model: string;
  messages: unknown[];
  stream: boolean;
  [key: string]: unknown;
}

export interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatResult {
  status: number;
  contentType: string;
  body?: unknown;
  stream?: ReadableStream<Uint8Array> | null;
  usage?: UpstreamUsage | null;
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** Per-account upstream base URL; falls back to provider default. */
  baseUrl?: string;
}

/**
 * Provider abstraction. A provider knows how to talk to one upstream vendor;
 * the gateway never hardcodes vendor specifics in route handlers.
 */
export interface AIProvider {
  readonly name: string;
  getAccount(token: string): Promise<ProviderAccountInfo>;
  getPlan(token: string): Promise<{ configured: boolean; plan?: string | null }>;
  getQuota(token: string): Promise<ProviderQuota>;
  getUsage(token: string): Promise<ProviderUsage>;
  getModels(token: string): Promise<{ configured: boolean; models: ProviderModel[] }>;
  chat(token: string, request: ChatRequest, opts?: ChatOptions): Promise<ChatResult>;
}
