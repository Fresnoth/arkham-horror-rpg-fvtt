// Straining Oneself — core p. 31.
//
// A character whose dice pool limit has been reduced below its maximum may strain themself:
// the limit snaps back to the maximum (in system terms `system.damage = 0`), and in exchange
// they suffer one injury. Straining is not an action and costs no dice.
//
// Who may do it:
//   - character: as often as they like
//   - npc:       only with the "Major NPC" knack, and only ONCE (core p. 190/196). Afterwards
//                being wounded means the NPC is immediately removed from play.
//   - vehicle:   never
//
// The rule checks below are pure so they can be exercised without a live Foundry instance;
// only `strainAndPost` touches documents, dialogs and chat.

import { refreshDicepoolAndPost } from "./dicepool.mjs";
// Opens the same dialog as `api/rolls/openInjuryTraumaDialog`, but imported directly: routing
// through the rolls API would create the import cycle
// api/resources -> helpers/strain -> api/rolls -> dice-roll-app -> skill-roll-workflow -> api/resources.
import { InjuryTraumaRollApp } from "../apps/injury-trauma-roll-app.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/strain.hbs`;

const STRAIN_CAPABLE_TYPES = new Set(["character", "npc"]);

// Name of the stat-block knack that turns a minor NPC into a major one.
const MAJOR_NPC_KNACK_NAME = "major npc";

function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDamage(actor) {
  return Math.max(0, toNumber(actor?.system?.damage, 0));
}

function getDicepoolMax(actor) {
  return Math.max(0, toNumber(actor?.system?.dicepool?.max, 0));
}

function getItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  return items.contents ?? (Array.isArray(items) ? items : [...items]);
}

/**
 * "Wounded" is the state where the dice pool limit has been reduced to zero (core p. 31).
 */
export function isWounded(actor) {
  const max = getDicepoolMax(actor);
  if (max <= 0) return false;
  return getDamage(actor) >= max;
}

/**
 * Detects the "Major NPC" knack on an NPC stat block.
 *
 * Two detection paths on purpose:
 *   1. `flags["arkham-horror-rpg-fvtt"].grantsStrain === true` is the explicit, robust marker and
 *      the one new content should use.
 *   2. The name match exists because the shipped compendium data does not carry that flag yet —
 *      every major NPC there simply has a knack literally named "Major NPC". Dropping the name
 *      match would silently disable straining for all existing NPCs.
 */
export function hasMajorNpcKnack(actor) {
  for (const item of getItems(actor)) {
    if (item?.type !== "knack") continue;
    if (item?.flags?.[SYSTEM_ID]?.grantsStrain === true) return true;
    if (String(item?.name ?? "").trim().toLowerCase() === MAJOR_NPC_KNACK_NAME) return true;
  }
  return false;
}

export function hasStrainedOnce(actor) {
  return Boolean(actor?.system?.strainedOnce);
}

/**
 * Pure rules check. Ownership is deliberately NOT part of it — permissions are enforced in
 * `strainAndPost`, so the sheet can render a meaningful button state for observers too.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function canStrain(actor) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };
  if (!STRAIN_CAPABLE_TYPES.has(String(actor.type ?? ""))) {
    return { ok: false, reason: "ACTOR_TYPE_UNSUPPORTED" };
  }
  if (getDamage(actor) <= 0) return { ok: false, reason: "NOT_DAMAGED" };

  if (actor.type === "npc") {
    if (!hasMajorNpcKnack(actor)) return { ok: false, reason: "MAJOR_NPC_REQUIRED" };
    if (hasStrainedOnce(actor)) return { ok: false, reason: "ALREADY_STRAINED" };
  }

  return { ok: true, reason: null };
}

/**
 * Everything a sheet header needs to render the button, so the template stays free of logic.
 */
export function getStrainButtonState(actor) {
  const check = canStrain(actor);
  const type = String(actor?.type ?? "");

  return {
    // Minor NPCs and vehicles get no button at all — offering a permanently dead control
    // would only suggest the rule applied to them.
    visible: type === "character" || (type === "npc" && hasMajorNpcKnack(actor)),
    ok: check.ok,
    reason: check.reason,
    wounded: isWounded(actor),
    strainedOnce: type === "npc" && hasStrainedOnce(actor),
    tooltip: check.ok
      ? t("ARKHAM_HORROR.STRAIN.Tooltip")
      : t(`ARKHAM_HORROR.STRAIN.Reasons.${check.reason}`),
  };
}

async function confirmStrain(actor) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return true;

  const lines = [
    `<p>${t("ARKHAM_HORROR.STRAIN.Dialog.Prompt", { actorName: actor.name })}</p>`,
    `<p><em>${t("ARKHAM_HORROR.STRAIN.Dialog.Price")}</em></p>`,
  ];
  if (actor.type === "npc") {
    lines.push(`<p class="notification warning">${t("ARKHAM_HORROR.STRAIN.Dialog.NpcOnce")}</p>`);
  }

  const answer = await DialogV2.confirm({
    window: { title: t("ARKHAM_HORROR.STRAIN.Dialog.Title") },
    content: lines.join(""),
    yes: { label: t("ARKHAM_HORROR.STRAIN.Dialog.Confirm"), icon: "fa-solid fa-hand-fist" },
    no: { label: t("ARKHAM_HORROR.STRAIN.Dialog.Cancel") },
    modal: true,
    rejectClose: false,
  });

  return answer === true;
}

/**
 * Runs the full rule: confirm → restore the dice pool limit → mark an NPC's one-shot as used →
 * open the injury roll → post a summary card.
 *
 * The injury is rolled right away rather than "at the end of the turn"; Foundry has no reliable
 * turn tracking here and the GM can simply hold the result.
 *
 * @returns {Promise<{ ok: boolean, reason: string|null, ... }>}
 */
export async function strainAndPost({
  actor,
  notify = true,
  confirm = true,
  rollMode = "roll",
  source = "sheet",
} = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.STRAIN.Reasons.${reason}`));
    return { ok: false, reason };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const check = canStrain(actor);
  if (!check.ok) return fail(check.reason);

  if (confirm && !(await confirmStrain(actor))) {
    return { ok: false, reason: "CANCELLED" };
  }

  const wasWounded = isWounded(actor);
  const isNpc = actor.type === "npc";

  // postChat: false — the summary card below already reports the pool change plus the price.
  const refresh = await refreshDicepoolAndPost({
    actor,
    label: t("ARKHAM_HORROR.STRAIN.Chat.Label"),
    healDamage: true,
    postChat: false,
  });

  // The Major NPC knack allows exactly one strain; from here on being wounded takes the NPC out.
  if (isNpc) await actor.update({ "system.strainedOnce": true });

  InjuryTraumaRollApp.getInstance({
    actor,
    rollKind: "injury",
    rollSource: "strain",
  }).render(true);

  const chatVars = {
    actorName: actor.name,
    oldDicePoolValue: refresh?.oldDicePoolValue ?? 0,
    newDicePoolValue: refresh?.newDicePoolValue ?? 0,
    healedDamage: refresh?.healedDamage ?? 0,
    wasWounded,
    npcStrainSpent: isNpc,
  };

  await createArkhamHorrorChatCard(
    {
      actor,
      template: TEMPLATE,
      chatVars,
      flags: {
        [SYSTEM_ID]: {
          ...chatVars,
          schemaVersion: 1,
          rollCategory: "strain",
          actorUuid: actor.uuid ?? "",
          source,
        },
      },
    },
    { rollMode }
  );

  return {
    ok: true,
    reason: null,
    source,
    wasWounded,
    npcStrainSpent: isNpc,
    refresh,
    injuryDialogOpened: true,
  };
}
