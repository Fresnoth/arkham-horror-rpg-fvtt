// Button on the "trauma suffered" card. The card only reports the trigger (ones on horror dice,
// core p. 37); the roll itself waits for whoever is entitled to make it, so the GM keeps control
// over the timing — same reasoning as with straining oneself.

import { InjuryTraumaRollApp } from "../apps/injury-trauma-roll-app.mjs";
import { getSuggestedTraumaRollModifier } from "../helpers/trauma.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function resolveActorSync(actorUuid) {
  const sync = foundry.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  if (typeof sync !== "function" || !actorUuid) return null;
  try {
    const doc = sync(actorUuid);
    if (doc instanceof Actor) return doc;
    return doc?.actor ?? null;
  } catch (e) {
    return null;
  }
}

function canRollTrauma(actor) {
  if (game.user?.isGM) return true;
  return !!actor?.isOwner;
}

function decorateTraumaCard(message, html) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!flags || flags.rollCategory !== "trauma") return;

  const btn = html?.querySelector?.('[data-action="arkham-roll-trauma"]');
  if (!btn) return;

  const actorUuid = String(btn.dataset.actorUuid ?? flags.actorUuid ?? "");
  const actor = resolveActorSync(actorUuid);

  // Everyone sees the report; only the owner (or the GM) gets the button.
  if (!canRollTrauma(actor)) {
    btn.style.display = "none";
    return;
  }

  if (!actor) {
    btn.disabled = true;
    btn.dataset.tooltip = game.i18n.localize("ARKHAM_HORROR.TRAUMA.Reasons.ACTOR_NOT_FOUND");
    return;
  }

  btn.dataset.tooltip = game.i18n.localize("ARKHAM_HORROR.TRAUMA.Tooltip");

  if (btn.dataset.arkhamTraumaBound === "1") return;
  btn.dataset.arkhamTraumaBound = "1";

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const severityModifier = Number(btn.dataset.severityModifier ?? 0) || 0;
    InjuryTraumaRollApp.getInstance({
      actor,
      rollKind: "trauma",
      // Read from the live actor at click time: traumas may have been added since the report.
      modifier: getSuggestedTraumaRollModifier(actor, severityModifier),
      rollSource: "horror",
    }).render(true);
  });
}

export function registerChatTraumaHooks() {
  Hooks.on("renderChatMessageHTML", decorateTraumaCard);
}
