import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function buildInsightChatFlags({
  actor,
  action,
  spent,
  oldRemaining,
  newRemaining,
  limit,
  source,
  user,
} = {}) {
  const safeActor = actor ?? null;
  const safeUser = user ?? game?.user ?? null;
  const safeAction = action === "refresh" ? "refresh" : "spend";

  return {
    [SYSTEM_ID]: {
      schemaVersion: 1,
      rollCategory: "insight",
      label: safeAction === "refresh" ? "Refresh Insight" : "Spend Insight",
      action: safeAction,
      spent: safeAction === "spend" ? asSafeInteger(spent, 0) : 0,
      oldRemaining: asSafeInteger(oldRemaining, 0),
      newRemaining: asSafeInteger(newRemaining, 0),
      limit: asSafeInteger(limit, 0),
      delta: asSafeInteger(newRemaining, 0) - asSafeInteger(oldRemaining, 0),
      actorName: safeActor?.name ?? "",
      actorUuid: safeActor?.uuid ?? "",
      actorId: safeActor?.id ?? "",
      userId: safeUser?.id ?? "",
      source: source ?? "api",
    },
  };
}

function asSafeInteger(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

export function getInsightLimit(actor) {
  return asSafeInteger(actor?.system?.insight?.limit, 0);
}

export function getInsightRemaining(actor) {
  return asSafeInteger(actor?.system?.insight?.remaining, 0);
}

export function canSpendInsight(actor, { user = game?.user } = {}) {
  if (!actor || actor.type !== "character") return false;
  const hasPermission = !!actor.isOwner || !!user?.isGM;
  if (!hasPermission) return false;
  return getInsightRemaining(actor) > 0;
}

export async function spendInsight(actor, amount = 1) {
  if (!actor) {
    return {
      ok: false,
      reason: "no-actor",
      remaining: 0,
      limit: 0,
      oldRemaining: 0,
      newRemaining: 0,
      spent: 0,
    };
  }
  if (actor.type !== "character") {
    const remaining = getInsightRemaining(actor);
    const limit = getInsightLimit(actor);
    return {
      ok: false,
      reason: "type",
      remaining,
      limit,
      oldRemaining: remaining,
      newRemaining: remaining,
      spent: 0,
    };
  }

  const remaining = getInsightRemaining(actor);
  const limit = getInsightLimit(actor);

  const spend = asSafeInteger(amount, 0);
  if (spend <= 0) {
    return { ok: false, reason: "amount", remaining, limit, oldRemaining: remaining, newRemaining: remaining, spent: 0 };
  }

  if (remaining <= 0) {
    return { ok: false, reason: "none", remaining, limit, oldRemaining: remaining, newRemaining: remaining, spent: 0 };
  }

  if (spend > remaining) {
    return { ok: false, reason: "insufficient", remaining, limit, oldRemaining: remaining, newRemaining: remaining, spent: 0 };
  }

  const newRemaining = remaining - spend;
  await actor.update({ "system.insight.remaining": newRemaining });

  return { ok: true, reason: null, remaining: newRemaining, limit, oldRemaining: remaining, newRemaining, spent: spend };
}

export async function refreshInsight(actor) {
  if (!actor) {
    return { ok: false, reason: "no-actor", oldRemaining: 0, newRemaining: 0, limit: 0 };
  }
  if (actor.type !== "character") {
    const remaining = getInsightRemaining(actor);
    const limit = getInsightLimit(actor);
    return { ok: false, reason: "type", oldRemaining: remaining, newRemaining: remaining, limit };
  }

  const remaining = getInsightRemaining(actor);
  const limit = getInsightLimit(actor);
  const newRemaining = limit;

  await actor.update({ "system.insight.remaining": newRemaining });

  return { ok: true, oldRemaining: remaining, newRemaining, limit };
}

export async function spendInsightAndPost({ actor, amount = 1, rollMode = "roll", source = "api" } = {}) {
  if (!actor) {
    return await spendInsight(actor, amount);
  }

  if (!(actor.isOwner || game.user?.isGM)) {
    ui.notifications.warn("You do not have permission to spend Insight for this actor.");
    return {
      ok: false,
      reason: "permission",
      remaining: getInsightRemaining(actor),
      limit: getInsightLimit(actor),
      oldRemaining: getInsightRemaining(actor),
      newRemaining: getInsightRemaining(actor),
      spent: 0,
    };
  }

  if (actor.type !== "character") {
    ui.notifications.warn("Only character actors can spend Insight.");
    return await spendInsight(actor, amount);
  }

  const remaining = getInsightRemaining(actor);
  if (remaining <= 0) {
    ui.notifications.warn(`${actor.name} has no Insight remaining.`);
    return {
      ok: false,
      reason: "none",
      remaining,
      limit: getInsightLimit(actor),
      oldRemaining: remaining,
      newRemaining: remaining,
      spent: 0,
    };
  }

  const result = await spendInsight(actor, amount);
  if (!result.ok) {
    if (result.reason === "insufficient") {
      ui.notifications.warn(`${actor.name} does not have enough Insight remaining.`);
    } else if (result.reason === "amount") {
      ui.notifications.warn("Insight spend amount must be at least 1.");
    } else {
      ui.notifications.warn(`${actor.name} has no Insight remaining.`);
    }
    return result;
  }

  await createArkhamHorrorChatCard(
    {
      actor,
      template: "systems/arkham-horror-rpg-fvtt/templates/chat/insight-update.hbs",
      chatVars: {
        action: "spend",
        actorName: actor.name,
        spent: result.spent,
        oldRemaining: result.oldRemaining,
        newRemaining: result.newRemaining,
        limit: result.limit,
      },
      flags: buildInsightChatFlags({
        actor,
        action: "spend",
        spent: result.spent,
        oldRemaining: result.oldRemaining,
        newRemaining: result.newRemaining,
        limit: result.limit,
        source,
      }),
    },
    { rollMode }
  );

  return result;
}

export async function refreshInsightAndPost({ actor, rollMode = "roll", source = "api" } = {}) {
  if (!actor) {
    return await refreshInsight(actor);
  }

  if (!(actor.isOwner || game.user?.isGM)) {
    ui.notifications.warn("You do not have permission to refresh Insight for this actor.");
    return {
      ok: false,
      reason: "permission",
      oldRemaining: getInsightRemaining(actor),
      newRemaining: getInsightRemaining(actor),
      limit: getInsightLimit(actor),
    };
  }

  if (actor.type !== "character") {
    ui.notifications.warn("Only character actors can refresh Insight.");
    return await refreshInsight(actor);
  }

  const result = await refreshInsight(actor);
  if (!result?.ok) return result;

  await createArkhamHorrorChatCard(
    {
      actor,
      template: "systems/arkham-horror-rpg-fvtt/templates/chat/insight-update.hbs",
      chatVars: {
        action: "refresh",
        actorName: actor.name,
        oldRemaining: result.oldRemaining,
        newRemaining: result.newRemaining,
        limit: result.limit,
      },
      flags: buildInsightChatFlags({
        actor,
        action: "refresh",
        spent: 0,
        oldRemaining: result.oldRemaining,
        newRemaining: result.newRemaining,
        limit: result.limit,
        source,
      }),
    },
    { rollMode }
  );

  return result;
}
