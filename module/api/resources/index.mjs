import {
  canSpendDice,
  previewDiceSpend,
  spendSimpleActionDie as spendSimpleActionDieHelper,
  spendRollCost as spendRollCostHelper,
  discardDice as discardDiceHelper,
  discardAllDice as discardAllDiceHelper,
} from "../../helpers/resources.mjs";
import { canStrain, strainAndPost } from "../../helpers/strain.mjs";
import { applyDamageAndPost, previewDamage as previewDamageHelper } from "../../helpers/damage.mjs";
import {
  adjustHorrorLimit,
  applyHealingAndPost,
  previewHeal as previewHealHelper,
} from "../../helpers/healing.mjs";

export function canSpend(actor, {
  resourceType = "dicepool",
  amount,
  breakdown,
  context,
} = {}) {
  if (resourceType !== "dicepool") {
    return {
      ok: false,
      reason: "UNSUPPORTED_RESOURCE",
      maxSpendable: 0,
      failures: ["UNSUPPORTED_RESOURCE"],
      context: { type: String(context ?? "simple") || "simple" },
    };
  }

  return canSpendDice(actor, {
    totalDiceCost: amount,
    horrorDiceCost: breakdown?.horror,
    context,
  });
}

export function previewSpend(actor, {
  resourceType = "dicepool",
  amount,
  breakdown,
  context,
} = {}) {
  if (resourceType !== "dicepool") {
    return {
      ok: false,
      reason: "UNSUPPORTED_RESOURCE",
      warnings: [],
      context: { type: String(context ?? "simple") || "simple" },
      resource: {
        type: String(resourceType),
        amountRequested: Number(amount ?? 0) || 0,
        breakdownRequested: breakdown ?? {},
      },
      applied: { total: 0, breakdown: {} },
      before: {},
      after: {},
      chat: { posted: false },
      meta: { actorId: String(actor?.id ?? ""), timestamp: new Date().toISOString(), version: "v1" },
    };
  }

  return previewDiceSpend(actor, {
    totalDiceCost: amount,
    horrorDiceCost: breakdown?.horror,
    context,
  });
}

export async function spendResource(actor, {
  resourceType = "dicepool",
  amount,
  breakdown,
  context,
  postChat = true,
  chatVisibility = "public",
  source,
} = {}) {
  if (resourceType !== "dicepool") {
    return {
      ok: false,
      reason: "UNSUPPORTED_RESOURCE",
      warnings: [],
      context: { type: String(context ?? "simple") || "simple", source },
      resource: {
        type: String(resourceType),
        amountRequested: Number(amount ?? 0) || 0,
        breakdownRequested: breakdown ?? {},
      },
      applied: { total: 0, breakdown: {} },
      before: {},
      after: {},
      chat: { posted: false },
      meta: { actorId: String(actor?.id ?? ""), timestamp: new Date().toISOString(), version: "v1" },
    };
  }

  const contextType = String(context ?? "simple") || "simple";
  if (contextType === "simple" && Number(amount ?? 0) === 1 && (breakdown?.horror === 1 || breakdown?.regular === 1)) {
    const dieType = breakdown?.horror === 1 ? "horror" : "regular";
    return spendSimpleActionDie(actor, {
      dieType,
      context: contextType,
      postChat,
      chatVisibility,
      source,
    });
  }

  return spendRollCost(actor, {
    totalDiceCost: amount,
    horrorDiceCost: breakdown?.horror,
    context: contextType,
    source,
  });
}

export async function spendSimpleActionDie(actor, {
  dieType = "regular",
  context = "simple",
  postChat = true,
  chatVisibility = "public",
  source = "sheet",
} = {}) {
  return spendSimpleActionDieHelper(actor, {
    dieType,
    context,
    postChat,
    chatVisibility,
    source,
  });
}

export async function spendRollCost(actor, {
  totalDiceCost,
  horrorDiceCost,
  context = "complex",
  source = "workflow",
} = {}) {
  return spendRollCostHelper(actor, {
    totalDiceCost,
    horrorDiceCost,
    context,
    source,
  });
}

export async function discardDice(actor, {
  amount = 1,
  context = "discard",
  postChat = true,
  chatVisibility = "public",
  source = "sheet",
} = {}) {
  return discardDiceHelper(actor, {
    amount,
    context,
    postChat,
    chatVisibility,
    source,
  });
}

export async function discardAllDice(actor, {
  context = "discard",
  postChat = true,
  chatVisibility = "public",
  source = "sheet",
} = {}) {
  return discardAllDiceHelper(actor, {
    context,
    postChat,
    chatVisibility,
    source,
  });
}

/**
 * Strain Oneself (core p. 31): restore the dice pool limit to its maximum at the price of one
 * injury. Callers that already asked the user (or that drive automation) can skip the built-in
 * confirmation dialog via `confirm: false`.
 */
export async function strain(actor, {
  confirm = true,
  notify = true,
  rollMode = "roll",
  source = "api",
} = {}) {
  return strainAndPost({ actor, confirm, notify, rollMode, source });
}

/**
 * Pure rules probe for the same action — useful for module UIs that want to render their own
 * button. Never notifies and never mutates.
 */
export function canStrainResource(actor) {
  return canStrain(actor);
}

/**
 * Damage (core p. 31): every point lowers the dice pool limit by one. Damage reduction from armour,
 * knacks or relics is rules text and is never applied here — callers pass the final number.
 */
export async function applyDamage(actor, {
  amount = 0,
  horror = 0,
  source = "api",
  attackerName = "",
  weaponName = "",
  rollMode = "roll",
  notify = true,
} = {}) {
  return applyDamageAndPost({ actor, amount, horror, source, attackerName, weaponName, rollMode, notify });
}

/**
 * Pure probe for the same action: what the limit would look like afterwards. Never mutates.
 */
export function previewDamage(actor, amount) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED", ...previewDamageHelper(null, amount) };
  return { ok: true, reason: null, ...previewDamageHelper(actor, amount) };
}

/**
 * Healing (core p. 33): a Knowledge roll heals 1 damage per success, which raises the dice pool
 * limit by the same amount. Bonuses from medical supplies are rules text and are never added here —
 * callers pass the final number. `injuryIds` heals injuries in the same step (core p. 33-34).
 */
export async function heal(actor, {
  amount = 0,
  injuryIds = [],
  source = "api",
  healerName = "",
  rollMode = "roll",
  notify = true,
} = {}) {
  return applyHealingAndPost({ actor, amount, injuryIds, source, healerName, rollMode, notify });
}

/**
 * Pure probe for the same action: what the limit would look like afterwards. Never mutates.
 */
export function previewHeal(actor, amount) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED", ...previewHealHelper(null, amount) };
  return { ok: true, reason: null, ...previewHealHelper(actor, amount) };
}

/**
 * Removes a single injury (core p. 33-34). Routed through `heal` so the change is reported in chat
 * like every other applied result. Whether the successes were enough is the caller's decision — the
 * dialog enforces it, the API does not.
 */
export async function healInjury(actor, {
  injuryId,
  source = "api",
  healerName = "",
  rollMode = "roll",
  notify = true,
} = {}) {
  return applyHealingAndPost({
    actor,
    amount: 0,
    injuryIds: [injuryId],
    source,
    healerName,
    rollMode,
    notify,
  });
}

/**
 * Changes the horror limit (core p. 38). Introspection and Counseling pass `delta: -1` — a success
 * lowers the limit by exactly 1, never by the number of successes.
 */
export async function adjustHorror(actor, {
  delta = -1,
  source = "api",
  healerName = "",
  rollMode = "roll",
  postChat = true,
  notify = true,
} = {}) {
  return adjustHorrorLimit(actor, delta, { source, healerName, rollMode, postChat, notify });
}

export const resourcesApi = {
  version: "v1",
  canSpend,
  previewSpend,
  spendResource,
  spendSimpleActionDie,
  spendRollCost,
  discardDice,
  discardAllDice,
  strain,
  canStrain: canStrainResource,
  applyDamage,
  previewDamage,
  heal,
  previewHeal,
  healInjury,
  adjustHorror,
};
