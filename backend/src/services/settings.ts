import { config } from '../config.js';
import { getSettingValue, listSettings, setSettingValue } from './audit.js';

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

export const DEFAULT_SETTINGS: GatewaySettings = {
  gatewayUrl: 'http://localhost:8080',
  defaultModel: 'mimo-v2',
  quotaMode: config.env.QUOTA_MODE,
  requestsPerMinute: config.env.RATE_LIMIT_RPM,
  requestsPerHour: config.env.RATE_LIMIT_RPH,
  syncIntervalSeconds: config.env.SYNC_INTERVAL_SECONDS,
  reservationTtlSeconds: config.env.RESERVATION_TTL_SECONDS,
  logLevel: config.env.LOG_LEVEL,
  corsOrigin: config.env.CORS_ORIGIN,
};

export async function getSettings(): Promise<GatewaySettings> {
  const stored = await listSettings();
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<GatewaySettings>) };
}

export async function patchSettings(patch: Partial<GatewaySettings>): Promise<GatewaySettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) await setSettingValue(key, value);
  }
  return getSettings();
}

export async function getSetting<K extends keyof GatewaySettings>(key: K): Promise<GatewaySettings[K]> {
  return getSettingValue<GatewaySettings[K]>(key, DEFAULT_SETTINGS[key]);
}
