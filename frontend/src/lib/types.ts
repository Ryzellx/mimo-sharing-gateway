export interface AllocationView {
  userId: string;
  username: string;
  email: string;
  status: string;
  sharedPool: boolean;
  accountId: string | null;
  totalTokens: number;
  usedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  usagePercent: number;
  lastRequestAt: string | null;
  expiresAt?: string | null;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  status: string;
  sharedPool: boolean;
  createdAt: string;
  lastRequestAt: string | null;
  expiresAt: string | null;
}

export interface UserListRow {
  user: UserRow & { accountLabel: string | null };
  allocation: {
    totalTokens: number;
    usedTokens: number;
    reservedTokens: number;
  } | null;
}

export interface ApiKeyView {
  id: string;
  name: string;
  masked: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MimoAccountView {
  id: string;
  label: string;
  baseUrl: string;
  tokenMasked: string;
  status: string;
  plan: string | null;
  totalQuota: number | null;
  usedQuota: number | null;
  remainingQuota: number | null;
  quotaResetAt: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

export interface AccountDetail {
  account: MimoAccountView;
  allocations: AllocationView[];
  models: { id: string; modelId: string; ownedBy: string | null }[];
  localUsed: number;
  sumAllocated: number;
}

export interface DetectResult {
  detected: boolean;
  plan: string | null;
  totalQuota: number | null;
  usedQuota: number | null;
  remainingQuota: number | null;
  quotaResetAt: string | null;
  models: { id: string; ownedBy: string | null }[];
  accountPath: string | null;
  usagePath: string | null;
  modelsPath: string | null;
  chatPath: string | null;
  errors: Record<string, string>;
}

export interface CustomModelView {
  id: string;
  accountId: string;
  accountLabel: string;
  modelAlias: string;
  targetModel: string;
  systemPrompt: string;
  status: string;
  createdAt: string;
}

export interface DashboardData {
  plan: string | null;
  quota: {
    total: number | null;
    used: number;
    remaining: number | null;
    usagePercent: number;
  };
  allocation: { totalAllocated: number; available: number | null };
  users: { total: number };
  requests: { today: number; total: number };
  usage: { today: number; month: number; inputTokens: number; outputTokens: number };
  system: {
    status: string;
    mimoConnection: string;
    syncedAt: string | null;
    quotaMode: string;
    updatedAt: string;
  };
  accounts: {
    id: string;
    label: string;
    status: string;
    plan: string | null;
    totalQuota: number | null;
    usedQuota: number | null;
    remainingQuota: number | null;
    tokenMasked: string;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
  }[];
}

export interface UsageRow {
  id: string;
  requestId: string | null;
  userId: string | null;
  username: string | null;
  accountId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  usageSource: 'official' | 'estimated';
  cost: number | null;
  durationMs: number | null;
  httpStatus: number | null;
  createdAt: string;
}

export interface UsageResponse {
  rows: UsageRow[];
  totals: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
  byDay: { day: string; totalTokens: number; requests: number }[];
  byModel: { model: string; totalTokens: number; requests: number }[];
}

export interface RequestLogRow {
  id: string;
  requestId: string;
  userId: string | null;
  model: string | null;
  path: string;
  stream: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number | null;
  clientIp: string | null;
  createdAt: string;
}

export interface ReconciliationRow {
  accountId: string;
  label: string;
  localUsage: number;
  officialUsage: number | null;
  difference: number | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  configured: boolean;
}

export interface GatewaySettings {
  gatewayUrl: string;
  defaultModel: string;
  quotaMode: 'allocation' | 'shared_pool';
  requestsPerMinute: number;
  requestsPerHour: number;
  syncIntervalSeconds: number;
  reservationTtlSeconds: number;
  logLevel: string;
  corsOrigin: string;
}

export interface MeResponse {
  user: {
    id: string;
    username: string;
    email: string;
    status: string;
    lastRequestAt: string | null;
    expiresAt: string | null;
  };
  allocation: {
    total: number;
    used: number;
    reserved: number;
    remaining: number;
    remainingPercent: number;
    exhausted: boolean;
  };
  account: {
    id: string;
    label: string;
    plan: string | null;
    remainingQuota: number | null;
    expiresAt: string | null;
  } | null;
  apiKeys: ApiKeyView[];
  rate: { requestsPerMinute: number; requestsPerHour: number } | null;
  models: string[];
  recentRequests: RequestLogRow[];
  usage: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AllocationListResponse {
  totalAllocatable: number | null;
  totalAllocated: number;
  remainingAllocatable: number | null;
  allocations: AllocationView[];
}
