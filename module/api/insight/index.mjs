import { SpendInsightApp } from "../../apps/spend-insight-app.mjs";
import { refreshInsightAndPost, spendInsightAndPost } from "../../helpers/insight.mjs";

function hasInsightPermission(actor) {
  return !!(actor?.isOwner || game.user?.isGM);
}

export async function openSpendDialog(actor) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };
  if (actor?.type === "vehicle") return { ok: false, reason: "ACTOR_TYPE_UNSUPPORTED" };

  if (!hasInsightPermission(actor)) {
    ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.INSIGHT.Errors.PermissionSpend"));
    return { ok: false, reason: "PERMISSION_DENIED" };
  }

  if (actor?.type !== "character") return { ok: false, reason: "ACTOR_TYPE_UNSUPPORTED" };

  const remaining = Number(actor.system?.insight?.remaining ?? 0) || 0;
  if (remaining <= 0) {
    ui.notifications.warn(game.i18n.format("ARKHAM_HORROR.INSIGHT.Errors.NoneRemaining", { actorName: actor.name }));
    return { ok: false, reason: "INSIGHT_NONE_REMAINING" };
  }

  SpendInsightApp.getInstance({ actor }).render(true);
  return { ok: true, reason: null };
}

export async function spendAndPost(actor, {
  amount = 1,
  source = "api",
  rollMode = "roll",
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };
  return spendInsightAndPost({ actor, amount, source, rollMode });
}

export async function refreshAndPost(actor, {
  source = "api",
  rollMode = "roll",
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };
  return refreshInsightAndPost({ actor, source, rollMode });
}

export const insightApi = {
  version: "v1",
  openSpendDialog,
  spendAndPost,
  refreshAndPost,
};
