import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { customModels, mimoAccounts } from '../db/schema.js';
import { errors } from '../lib/errors.js';

export type CustomModelRow = typeof customModels.$inferSelect;

export interface CustomModelView {
  id: string;
  accountId: string;
  accountLabel: string;
  modelAlias: string;
  targetModel: string;
  systemPrompt: string;
  status: string;
  createdAt: Date;
}

/**
 * Custom models = model aliases with an injected system prompt. The gateway
 * rewrites `modelAlias` -> `targetModel` and prepends the prompt as a system
 * message before calling the upstream, so an admin can expose "mod"/"unc"
 * variants of any base model without touching the upstream account.
 */
export class CustomModelService {
  async list(): Promise<CustomModelView[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: customModels.id,
        accountId: customModels.accountId,
        accountLabel: mimoAccounts.label,
        modelAlias: customModels.modelAlias,
        targetModel: customModels.targetModel,
        systemPrompt: customModels.systemPrompt,
        status: customModels.status,
        createdAt: customModels.createdAt,
      })
      .from(customModels)
      .innerJoin(mimoAccounts, eq(mimoAccounts.id, customModels.accountId))
      .orderBy(customModels.createdAt);
    return rows;
  }

  async listByAccount(accountId: string): Promise<CustomModelRow[]> {
    return getDb()
      .select()
      .from(customModels)
      .where(eq(customModels.accountId, accountId));
  }

  async create(params: {
    accountId: string;
    modelAlias: string;
    targetModel: string;
    systemPrompt: string;
  }): Promise<CustomModelRow> {
    const db = getDb();
    const alias = params.modelAlias.trim();
    const target = params.targetModel.trim();
    if (!alias || !target) throw errors.validation('modelAlias and targetModel are required');
    const account = await db
      .select({ id: mimoAccounts.id })
      .from(mimoAccounts)
      .where(eq(mimoAccounts.id, params.accountId))
      .limit(1);
    if (account.length === 0) throw errors.notFound('Mimo account not found');

    const [row] = await db
      .insert(customModels)
      .values({
        accountId: params.accountId,
        modelAlias: alias,
        targetModel: target,
        systemPrompt: params.systemPrompt,
      })
      .onConflictDoNothing({ target: [customModels.accountId, customModels.modelAlias] })
      .returning();
    if (!row) throw errors.validation(`Custom model "${alias}" already exists on this account`);
    return row;
  }

  async update(
    id: string,
    patch: {
      modelAlias?: string;
      targetModel?: string;
      systemPrompt?: string;
      status?: 'active' | 'disabled';
    },
  ): Promise<CustomModelRow> {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (patch.modelAlias !== undefined) set.modelAlias = patch.modelAlias.trim();
    if (patch.targetModel !== undefined) set.targetModel = patch.targetModel.trim();
    if (patch.systemPrompt !== undefined) set.systemPrompt = patch.systemPrompt;
    if (patch.status !== undefined) set.status = patch.status;
    const [row] = await db.update(customModels).set(set).where(eq(customModels.id, id)).returning();
    if (!row) throw errors.notFound('Custom model not found');
    return row;
  }

  async remove(id: string) {
    const [row] = await getDb().delete(customModels).where(eq(customModels.id, id)).returning();
    if (!row) throw errors.notFound('Custom model not found');
    return row;
  }

  /**
   * Resolve a requested model name against the custom catalog.
   * Returns the upstream target + system prompt to inject, or null when the
   * name is a plain upstream model (pass-through).
   */
  async resolve(alias: string, accountId: string | null): Promise<CustomModelRow | null> {
    const db = getDb();
    const cond = and(
      eq(customModels.modelAlias, alias),
      eq(customModels.status, 'active'),
      ...(accountId ? [eq(customModels.accountId, accountId)] : []),
    );
    const rows = await db.select().from(customModels).where(cond).limit(1);
    return rows[0] ?? null;
  }
}

export const customModels$ = new CustomModelService();