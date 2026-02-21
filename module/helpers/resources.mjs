import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const SIMPLE_ACTION_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/simple-action-spend.hbs`;
const DICEPOOL_DISCARD_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/dicepool-discard.hbs`;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toContextType(value) {
  const raw = String(value ?? "simple").trim();
  return raw || "simple";
}

function toRollMode(visibility) {
  const map = {
    public: "roll",
    owner: "selfroll",
    gm: "gmroll",
  };
  const key = String(visibility ?? "public").toLowerCase();
  return map[key] ?? "roll";
}

function buildEnvelope({
  ok,
  reason = null,
  warnings = [],
  context,
  amountRequested,
  breakdownRequested,
  appliedTotal,
  appliedBreakdown,
  before,
  after,
  chat,
  actor,
}) {
  return {
    ok: !!ok,
    reason,
    warnings: Array.isArray(warnings) ? warnings : [],
    context,
    resource: {
      type: "dicepool",
      amountRequested: toNumber(amountRequested, 0),
      breakdownRequested: breakdownRequested ?? {},
    },
    applied: {
      total: toNumber(appliedTotal, 0),
      breakdown: appliedBreakdown ?? {},
    },
    before,
    after,
    chat,
    meta: {
      actorId: String(actor?.id ?? ""),
      timestamp: new Date().toISOString(),
      version: "v1",
    },
  };
}

function getDiceSnapshot(actor) {
  const dicepool = Math.max(0, toNumber(actor?.system?.dicepool?.value, 0));
  const horrorLimit = Math.max(0, toNumber(actor?.system?.horror, 0));
  const rawHorrorInPool = actor?.system?.dicepool?.horrorInPool;
  const storedHorrorInPool = (rawHorrorInPool === null || rawHorrorInPool === undefined)
    ? Number.NaN
    : toNumber(rawHorrorInPool, Number.NaN);
  const fallbackHorrorInPool = Math.min(horrorLimit, dicepool);
  const horrorInPool = Number.isFinite(storedHorrorInPool)
    ? Math.max(0, Math.min(storedHorrorInPool, dicepool, horrorLimit))
    : fallbackHorrorInPool;
  const regular = Math.max(0, dicepool - horrorInPool);
  return { dicepool, horror: horrorInPool, horrorInPool, horrorLimit, regular };
}

function hasSpendPermission(actor) {
  return !!(actor?.isOwner || game.user?.isGM);
}

function resolveAutoHorrorSpend({ totalDiceCost, snapshot }) {
  const total = Math.max(0, toNumber(totalDiceCost, 0));
  if (total <= 0) return 0;

  const normalDice = Math.max(0, snapshot.dicepool - snapshot.horror);
  if (normalDice >= total) return 0;
  return Math.min(snapshot.horror, total - normalDice);
}

function validateDiceSpend({ snapshot, totalDiceCost, horrorDiceCost }) {
  const total = Math.max(0, toNumber(totalDiceCost, 0));
  const horror = Math.max(0, toNumber(horrorDiceCost, 0));
  const regular = Math.max(0, total - horror);

  if (total <= 0) return { ok: false, reason: "AMOUNT_INVALID" };
  if (horror > total) return { ok: false, reason: "HORROR_EXCEEDS_TOTAL" };
  if (snapshot.dicepool < total) return { ok: false, reason: "INSUFFICIENT_DICEPOOL" };
  if (snapshot.horror < horror) return { ok: false, reason: "INSUFFICIENT_HORROR" };
  if (snapshot.regular < regular) return { ok: false, reason: "INSUFFICIENT_REGULAR" };

  return { ok: true, regular, horror, total };
}

async function postSimpleActionChat({ actor, dieType, amount, before, after, chatVisibility = "public", source }) {
  const dieTypeKey = dieType === "horror"
    ? "ARKHAM_HORROR.Chat.SimpleAction.DieTypeHorror"
    : "ARKHAM_HORROR.Chat.SimpleAction.DieTypeRegular";

  const chatVars = {
    actorName: actor.name,
    amount,
    dieType,
    dieTypeLabel: game.i18n.localize(dieTypeKey),
    oldDicePoolValue: before.dicepool,
    newDicePoolValue: after.dicepool,
  };

  const flags = {
    [SYSTEM_ID]: {
      ...chatVars,
      source: String(source ?? "sheet"),
      rollCategory: "simple-action",
      actionContext: "simple",
    },
  };

  const message = await createArkhamHorrorChatCard(
    { actor, template: SIMPLE_ACTION_TEMPLATE, chatVars, flags },
    { rollMode: toRollMode(chatVisibility) },
  );

  return String(message?.id ?? "");
}

async function postDiscardChat({ actor, amount, discardedRegular, discardedHorror, before, after, chatVisibility = "public", source }) {
  const chatVars = {
    actorName: actor.name,
    amount,
    discardedRegular,
    discardedHorror,
    oldDicePoolValue: before.dicepool,
    newDicePoolValue: after.dicepool,
  };

  const flags = {
    [SYSTEM_ID]: {
      ...chatVars,
      source: String(source ?? "sheet"),
      rollCategory: "dicepool-discard",
      actionContext: "discard",
    },
  };

  const message = await createArkhamHorrorChatCard(
    { actor, template: DICEPOOL_DISCARD_TEMPLATE, chatVars, flags },
    { rollMode: toRollMode(chatVisibility) },
  );

  return String(message?.id ?? "");
}

function resolveDiscardBreakdown({ snapshot, amount }) {
  const requested = Math.max(0, toNumber(amount, 0));
  const regular = Math.min(snapshot.regular, requested);
  const horror = Math.max(0, requested - regular);
  return { requested, regular, horror };
}

async function spendDiceCore({
  actor,
  totalDiceCost,
  horrorDiceCost,
  context = "simple",
  postChat = false,
  chatVisibility = "public",
  source,
}) {
  const contextType = toContextType(context);

  if (!actor) {
    return buildEnvelope({
      ok: false,
      reason: "ACTOR_REQUIRED",
      context: { type: contextType, source },
      amountRequested: toNumber(totalDiceCost, 0),
      breakdownRequested: { horror: toNumber(horrorDiceCost, 0), regular: Math.max(0, toNumber(totalDiceCost, 0) - toNumber(horrorDiceCost, 0)) },
      appliedTotal: 0,
      appliedBreakdown: { regular: 0, horror: 0 },
      before: { dicepool: 0, horror: 0 },
      after: { dicepool: 0, horror: 0 },
      chat: { posted: false },
      actor,
    });
  }

  if (!hasSpendPermission(actor)) {
    const snapshot = getDiceSnapshot(actor);
    return buildEnvelope({
      ok: false,
      reason: "PERMISSION_DENIED",
      context: { type: contextType, source },
      amountRequested: toNumber(totalDiceCost, 0),
      breakdownRequested: { horror: toNumber(horrorDiceCost, 0), regular: Math.max(0, toNumber(totalDiceCost, 0) - toNumber(horrorDiceCost, 0)) },
      appliedTotal: 0,
      appliedBreakdown: { regular: 0, horror: 0 },
      before: { dicepool: snapshot.dicepool, horror: snapshot.horror },
      after: { dicepool: snapshot.dicepool, horror: snapshot.horror },
      chat: { posted: false },
      actor,
    });
  }

  const requestedTotal = Math.max(0, toNumber(totalDiceCost, 0));
  const before = getDiceSnapshot(actor);

  const requestedHorror = horrorDiceCost === undefined || horrorDiceCost === null
    ? resolveAutoHorrorSpend({ totalDiceCost: requestedTotal, snapshot: before })
    : Math.max(0, toNumber(horrorDiceCost, 0));

  const validation = validateDiceSpend({ snapshot: before, totalDiceCost: requestedTotal, horrorDiceCost: requestedHorror });
  if (!validation.ok) {
    return buildEnvelope({
      ok: false,
      reason: validation.reason,
      context: { type: contextType, source },
      amountRequested: requestedTotal,
      breakdownRequested: { horror: requestedHorror, regular: Math.max(0, requestedTotal - requestedHorror) },
      appliedTotal: 0,
      appliedBreakdown: { regular: 0, horror: 0 },
      before: { dicepool: before.dicepool, horror: before.horror },
      after: { dicepool: before.dicepool, horror: before.horror },
      chat: { posted: false },
      actor,
    });
  }

  const updateData = {
    "system.dicepool.value": Math.max(0, before.dicepool - validation.total),
    "system.dicepool.horrorInPool": Math.max(0, before.horrorInPool - validation.horror),
  };

  await actor.update(updateData);

  const after = getDiceSnapshot(actor);
  const applied = {
    total: validation.total,
    regular: validation.regular,
    horror: validation.horror,
  };

  let chatMessageId = undefined;
  if (postChat && contextType === "simple") {
    const dieType = validation.horror > 0 ? "horror" : "regular";
    chatMessageId = await postSimpleActionChat({
      actor,
      dieType,
      amount: validation.total,
      before,
      after,
      chatVisibility,
      source,
    });
  }

  return buildEnvelope({
    ok: true,
    reason: null,
    context: { type: contextType, source },
    amountRequested: requestedTotal,
    breakdownRequested: { horror: requestedHorror, regular: Math.max(0, requestedTotal - requestedHorror) },
    appliedTotal: applied.total,
    appliedBreakdown: { regular: applied.regular, horror: applied.horror },
    before: { dicepool: before.dicepool, horror: before.horror },
    after: { dicepool: after.dicepool, horror: after.horror },
    chat: {
      posted: Boolean(chatMessageId),
      messageId: chatMessageId,
      visibility: chatVisibility,
    },
    actor,
  });
}

export function canSpendDice(actor, {
  totalDiceCost,
  horrorDiceCost,
  context = "simple",
} = {}) {
  const snapshot = getDiceSnapshot(actor);
  const total = Math.max(0, toNumber(totalDiceCost, 0));
  const requestedHorror = horrorDiceCost === undefined || horrorDiceCost === null
    ? resolveAutoHorrorSpend({ totalDiceCost: total, snapshot })
    : Math.max(0, toNumber(horrorDiceCost, 0));

  const validation = validateDiceSpend({ snapshot, totalDiceCost: total, horrorDiceCost: requestedHorror });

  return {
    ok: validation.ok,
    reason: validation.ok ? null : validation.reason,
    maxSpendable: snapshot.dicepool,
    failures: validation.ok ? [] : [validation.reason],
    context: { type: toContextType(context) },
  };
}

export function previewDiceSpend(actor, {
  totalDiceCost,
  horrorDiceCost,
  context = "simple",
} = {}) {
  const before = getDiceSnapshot(actor);
  const total = Math.max(0, toNumber(totalDiceCost, 0));
  const requestedHorror = horrorDiceCost === undefined || horrorDiceCost === null
    ? resolveAutoHorrorSpend({ totalDiceCost: total, snapshot: before })
    : Math.max(0, toNumber(horrorDiceCost, 0));

  const validation = validateDiceSpend({ snapshot: before, totalDiceCost: total, horrorDiceCost: requestedHorror });
  if (!validation.ok) {
    return buildEnvelope({
      ok: false,
      reason: validation.reason,
      context: { type: toContextType(context) },
      amountRequested: total,
      breakdownRequested: { horror: requestedHorror, regular: Math.max(0, total - requestedHorror) },
      appliedTotal: 0,
      appliedBreakdown: { regular: 0, horror: 0 },
      before: { dicepool: before.dicepool, horror: before.horror },
      after: { dicepool: before.dicepool, horror: before.horror },
      chat: { posted: false },
      actor,
    });
  }

  const after = {
    dicepool: Math.max(0, before.dicepool - validation.total),
    horror: Math.max(0, before.horrorInPool - validation.horror),
    horrorInPool: Math.max(0, before.horrorInPool - validation.horror),
    horrorLimit: before.horrorLimit,
  };

  return buildEnvelope({
    ok: true,
    reason: null,
    context: { type: toContextType(context) },
    amountRequested: total,
    breakdownRequested: { horror: requestedHorror, regular: Math.max(0, total - requestedHorror) },
    appliedTotal: validation.total,
    appliedBreakdown: { regular: validation.regular, horror: validation.horror },
    before: { dicepool: before.dicepool, horror: before.horror },
    after,
    chat: { posted: false },
    actor,
  });
}

export async function spendSimpleActionDie(actor, {
  dieType = "regular",
  context = "simple",
  postChat = true,
  chatVisibility = "public",
  source = "sheet",
} = {}) {
  const normalized = String(dieType ?? "regular").toLowerCase() === "horror" ? "horror" : "regular";
  return spendDiceCore({
    actor,
    totalDiceCost: 1,
    horrorDiceCost: normalized === "horror" ? 1 : 0,
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
  return spendDiceCore({
    actor,
    totalDiceCost,
    horrorDiceCost,
    context,
    postChat: false,
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
  const before = getDiceSnapshot(actor);
  const breakdown = resolveDiscardBreakdown({ snapshot: before, amount });
  const result = await spendDiceCore({
    actor,
    totalDiceCost: breakdown.requested,
    horrorDiceCost: breakdown.horror,
    context,
    postChat: false,
    chatVisibility,
    source,
  });

  if (!result?.ok || !postChat) return result;

  const chatMessageId = await postDiscardChat({
    actor,
    amount: breakdown.requested,
    discardedRegular: breakdown.regular,
    discardedHorror: breakdown.horror,
    before,
    after: result.after ?? before,
    chatVisibility,
    source,
  });

  return {
    ...result,
    chat: {
      posted: Boolean(chatMessageId),
      messageId: chatMessageId,
      visibility: chatVisibility,
    },
  };
}

export async function discardAllDice(actor, {
  context = "discard",
  postChat = true,
  chatVisibility = "public",
  source = "sheet",
} = {}) {
  const snapshot = getDiceSnapshot(actor);
  return discardDice(actor, {
    amount: snapshot.dicepool,
    context,
    postChat,
    chatVisibility,
    source,
  });
}
