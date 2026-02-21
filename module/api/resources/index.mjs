import {
  canSpendDice,
  previewDiceSpend,
  spendSimpleActionDie as spendSimpleActionDieHelper,
  spendRollCost as spendRollCostHelper,
  discardDice as discardDiceHelper,
  discardAllDice as discardAllDiceHelper,
} from "../../helpers/resources.mjs";

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

export const resourcesApi = {
  version: "v1",
  canSpend,
  previewSpend,
  spendResource,
  spendSimpleActionDie,
  spendRollCost,
  discardDice,
  discardAllDice,
};
