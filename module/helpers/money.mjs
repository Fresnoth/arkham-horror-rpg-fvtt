import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function asSafeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

/**
 * Normalize to a safe, non-negative money value.
 *
 * Note: we round to 2 decimals to prevent float artifacts (e.g. 0.30000000000000004).
 */
export function normalizeMoney(amount) {
  const safe = Math.max(0, asSafeNumber(amount, 0));
  return Math.round(safe * 100) / 100;
}

/**
 * Parse user-entered money.
 *
 * Policy:
 * - Reject invalid strings and values with >2 decimals.
 * - Reject negatives.
 * - Allow optional leading '$' and commas.
 */
export function parseMoneyInput(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, reason: "empty", value: 0 };

  const normalized = input.replaceAll("$", "").replaceAll(",", "").trim();
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) {
    return { ok: false, reason: "invalid", value: 0 };
  }

  const parts = normalized.split(".");
  const fraction = parts[1] ?? "";
  if (fraction.length > 2) {
    return { ok: false, reason: "tooPrecise", value: 0 };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "invalid", value: 0 };
  if (value < 0) return { ok: false, reason: "negative", value: 0 };

  return { ok: true, reason: "ok", value: normalizeMoney(value) };
}

export function formatMoney(amount) {
  const safe = normalizeMoney(amount);
  return safe.toFixed(2);
}

export function formatCurrency(amount) {
  return `$${formatMoney(amount)}`;
}

export function getMoney(actor) {
  return normalizeMoney(actor?.system?.mundaneResources?.money ?? 0);
}

export async function setMoney(actor, newAmount) {
  if (!actor) return;
  const money = normalizeMoney(newAmount);
  await actor.update({
    "system.mundaneResources.money": money,
  });
}

export async function addMoney(actor, amount, { postToChat = false, rollMode = "roll" } = {}) {
  if (!actor) return;
  const delta = normalizeMoney(amount);
  const oldMoney = getMoney(actor);
  const newMoney = normalizeMoney(oldMoney + delta);
  await setMoney(actor, newMoney);
  if (postToChat) {
    await postMoneyChangeChat({ actor, action: "add", deltaAmount: delta, oldAmount: oldMoney, newAmount: newMoney, rollMode });
  }
}

export async function spendMoney(actor, amount, { postToChat = false, rollMode = "roll" } = {}) {
  if (!actor) return;
  const requested = normalizeMoney(amount);
  const oldMoney = getMoney(actor);
  const delta = normalizeMoney(Math.min(requested, oldMoney));
  const newMoney = normalizeMoney(Math.max(0, oldMoney - requested));
  await setMoney(actor, newMoney);
  if (postToChat) {
    await postMoneyChangeChat({ actor, action: "spend", deltaAmount: delta, oldAmount: oldMoney, newAmount: newMoney, rollMode });
  }
}

export async function postMoneyChangeChat({ actor, action, deltaAmount, oldAmount, newAmount, rollMode = "roll" } = {}) {
  const safeAction = action === "spend" ? "spend" : action === "set" ? "set" : "add";
  const delta = normalizeMoney(deltaAmount);
  const actorName = actor?.name ?? "";
  const balance = formatCurrency(newAmount);
  const deltaDisplay = formatCurrency(delta);

  let message = "";
  if (safeAction === "spend") {
    message = game.i18n.format("ARKHAM_HORROR.MONEY.Chat.Spent", { actorName, delta: deltaDisplay, balance });
  } else if (safeAction === "set") {
    message = game.i18n.format("ARKHAM_HORROR.MONEY.Chat.Set", { actorName, balance });
  } else {
    message = game.i18n.format("ARKHAM_HORROR.MONEY.Chat.Gained", { actorName, delta: deltaDisplay, balance });
  }

  await createArkhamHorrorChatCard(
    {
      actor,
      template: "systems/arkham-horror-rpg-fvtt/templates/chat/money-update.hbs",
      chatVars: {
        message,
      },
      flags: {
        [SYSTEM_ID]: {
          schemaVersion: 1,
          rollCategory: "money",
          action: safeAction,
          deltaAmount: delta,
          oldAmount: normalizeMoney(oldAmount),
          newAmount: normalizeMoney(newAmount),
          actorName,
          actorUuid: actor?.uuid ?? "",
        },
      },
    },
    { rollMode }
  );
}
