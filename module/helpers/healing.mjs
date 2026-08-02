// Healing — core p. 33-34 (damage, injuries) and p. 37-38 (horror).
//
// Three different mechanics that only look alike:
//   - damage:  a Knowledge roll heals 1 damage PER SUCCESS (core p. 33)
//   - injury:  a Knowledge roll removes an injury; some need 2 or 3 successes (core p. 33-34)
//   - horror:  Introspection (Resolve, on oneself) or Counseling (Presence, on a target) lower the
//              horror limit by EXACTLY 1 on a success — regardless of how many successes were
//              rolled (core p. 38)
// That last asymmetry is spelled out in both rules paragraphs and is easy to build wrong.
//
// Traumas are never healed (core p. 38, box "Healing Trauma?"), so there is deliberately no
// function for them.
//
// Deliberately NOT automated, only shown as hints in the dialog: "engaged" (GM's call, core p. 29),
// "narrative scenes only" and "once per scene per target" — Foundry knows no scene types in the
// rules sense.
//
// Everything except `applyHealingAndPost`, `healInjury`, `adjustHorrorLimit`, `applyRecovery` and
// the two chat helpers is pure, following the style of `damage.mjs`.

import { collectCurrentTargets } from "./defend.mjs";
import { refreshDicepoolAndPost } from "./dicepool.mjs";
import { createArkhamHorrorChatCard, renderChatHtml } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/healing-applied.hbs`;
const ROLL_RESULT_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/roll-result.hbs`;

/** Roll kinds of package 7. The names are part of the public contract (see TODO.md, section 8). */
export const HEAL_ROLL_KINDS = Object.freeze(["heal-damage", "heal-injury", "introspection", "counseling"]);

/** Skill each healing roll uses (core p. 33 and p. 38). */
export const HEAL_ROLL_SKILLS = Object.freeze({
  "heal-damage": "knowledge",
  "heal-injury": "knowledge",
  introspection: "resolve",
  counseling: "presence",
});

// Compendium content is English, hand-written items are usually in the user's language, so both
// spellings are matched. Deliberately broad: a missing hint is worse than one hint too many.
const HEAL_HINT_PATTERN = /heal|heilen|heilung|soign|gu[ée]ri|curar|sanar|first aid|medical/i;
const SUCCESS_WORD_PATTERN = /success|erfolg|succ[eè]s|[eé]xito/i;
const THREE_PATTERN = /\b(three|3|drei|trois|tres)\b/i;
const TWO_PATTERN = /\b(two|2|zwei|deux|dos)\b/i;

// Core p. 34: "Dire" is the one injury that never heals on its own. This is not derivable from the
// item text (unlike the heal difficulty), so the exception is maintained here by name — the same
// approach `strain.mjs` uses for the "Major NPC" knack, and for the same reason: the shipped
// compendium items do not carry `system.canHealNaturally` yet.
const NEVER_HEALS_NATURALLY = new Set(["dire"]);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  return items.contents ?? (Array.isArray(items) ? items : [...items]);
}

function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/**
 * "requires two successes to heal" (core p. 33-34) is part of the printed injury text, so the
 * difficulty can be read off the description instead of being maintained by hand.
 * @param {string} text
 * @returns {number} 2 or 3, or 0 when the text says nothing about it.
 */
function deriveHealDifficultyFromText(text) {
  const clean = stripHtml(text);
  if (!clean) return 0;

  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (!HEAL_HINT_PATTERN.test(sentence)) continue;
    if (!SUCCESS_WORD_PATTERN.test(sentence)) continue;
    if (THREE_PATTERN.test(sentence)) return 3;
    if (TWO_PATTERN.test(sentence)) return 2;
  }
  return 0;
}

/**
 * How many successes a single injury needs (core p. 33-34): 1 by default, 2 for Severely Injured,
 * Loss of a Sense and Comatose, 3 for Dire.
 *
 * The stored field only wins when it raises the difficulty: its initial value is 1 and cannot be
 * told apart from a hand-set 1, while every compendium injury ships without the field at all.
 *
 * @param {Item|object|null} injury
 * @returns {number} 1..3
 */
export function getInjuryHealDifficulty(injury) {
  const stored = toInteger(injury?.system?.healDifficulty, 0);
  if (stored >= 2) return Math.min(3, stored);

  const derived = deriveHealDifficultyFromText(injury?.system?.description);
  if (derived) return derived;

  return 1;
}

/**
 * Core p. 34: injuries heal on their own given time — except Dire, which never does.
 * @param {Item|object|null} injury
 * @returns {boolean}
 */
export function canInjuryHealNaturally(injury) {
  if (injury?.system?.canHealNaturally === false) return false;
  return !NEVER_HEALS_NATURALLY.has(String(injury?.name ?? "").trim().toLowerCase());
}

/**
 * The target's injuries, flagged with what the rolled successes are enough for.
 * Traumas are not listed: they cannot be healed at all (core p. 38).
 *
 * @param {Actor|null} actor
 * @param {object} [options]
 * @param {number} [options.successes]
 * @returns {Array<{id: string, name: string, img: string, difficulty: number, healable: boolean,
 *   canHealNaturally: boolean}>}
 */
export function getHealableInjuries(actor, { successes = 0, difficultyReduction = 0 } = {}) {
  const available = Math.max(0, toInteger(successes, 0));
  const reduction = Math.max(0, toInteger(difficultyReduction, 0));
  const entries = [];

  for (const item of getItems(actor)) {
    if (item?.type !== "injury") continue;
    const difficulty = getInjuryHealDifficulty(item);

    // A `healInjury` item lowers what an injury costs, but never below one success: core p. 33 has
    // healing happen "if they succeed", so a free removal is not a thing the rules allow.
    const effectiveDifficulty = Math.max(1, difficulty - reduction);

    entries.push({
      id: String(item.id ?? item._id ?? ""),
      name: String(item.name ?? ""),
      img: String(item.img ?? ""),
      difficulty,
      effectiveDifficulty,
      isReduced: effectiveDifficulty < difficulty,
      healable: available >= effectiveDifficulty,
      canHealNaturally: canInjuryHealNaturally(item),
    });
  }

  return entries;
}

/**
 * The items that contributed a healing modifier to this roll, as display rows.
 * Reads `appliedItems` and falls back to `appliedKnacks`, the older name of the same array.
 *
 * @param {object} flags The roll card's system flags.
 * @returns {Array<{name: string, text: string}>}
 */
export function collectHealEffectSources(flags = {}) {
  const applied = Array.isArray(flags?.appliedItems)
    ? flags.appliedItems
    : Array.isArray(flags?.appliedKnacks) ? flags.appliedKnacks : [];

  const sources = [];
  for (const entry of applied) {
    const effects = entry?.effects ?? {};
    const healDamage = toInteger(effects.healDamage, 0);
    const reduceHorror = toInteger(effects.reduceHorrorLimit, 0);

    const parts = [];
    if (healDamage) parts.push(t("ARKHAM_HORROR.ROLLEFFECTS.HealDamage", { count: healDamage }));
    if (effects.healInjury) parts.push(t("ARKHAM_HORROR.ROLLEFFECTS.HealInjury"));
    if (reduceHorror) parts.push(t("ARKHAM_HORROR.ROLLEFFECTS.ReduceHorrorLimit", { count: reduceHorror }));

    if (parts.length) sources.push({ name: String(entry?.name ?? ""), text: parts.join(", ") });
  }

  return sources;
}

/**
 * Turns a healing roll's result plus the item effects it carried into the numbers the apply dialog
 * works with. Pure, so the dialog stays a consumer and the rule asymmetries live in one place.
 *
 * The three modifiers behave differently on purpose (see `data/fields/roll-effects.mjs`):
 *   - `healDamage` adds flatly on top of the 1-damage-per-success of core p. 33
 *   - `healInjury` lowers the successes an injury costs by one (core p. 33-34), it does not grant
 *     an extra injury — "one more success towards injuries" would just be `addSuccesses`
 *   - `reduceHorrorLimit` adds on top of the exactly-one step of core p. 38, which is flat
 *     regardless of the success count
 *
 * @param {object} [options]
 * @param {string} [options.rollKind]
 * @param {number} [options.successes] Successes from the card, already including `addSuccesses`.
 * @param {object} [options.flags] The roll card's system flags.
 */
export function resolveHealEffects({ rollKind = "heal-damage", successes = 0, flags = {} } = {}) {
  const kind = String(rollKind ?? "");
  const horror = isHorrorRollKind(kind);
  const rolled = Math.max(0, toInteger(successes, 0));

  const bonusDamage = Math.max(0, toInteger(flags?.effectHealDamage, 0));
  const bonusHorror = Math.max(0, toInteger(flags?.effectReduceHorrorLimit, 0));
  const difficultyReduction = flags?.effectHealInjury ? 1 : 0;

  // Only a heal-damage roll turns successes into damage; an injury roll spends them on the injury.
  const baseAmount = kind === "heal-damage" ? rolled : 0;

  return {
    rollKind: kind,
    isHorror: horror,
    successes: rolled,
    baseAmount,
    bonusAmount: horror ? 0 : bonusDamage,
    amount: horror ? 0 : baseAmount + bonusDamage,
    difficultyReduction: horror ? 0 : difficultyReduction,
    horrorDelta: horror ? -(1 + bonusHorror) : 0,
    bonusHorror: horror ? bonusHorror : 0,
    sources: collectHealEffectSources(flags),
  };
}

/**
 * Medical supplies carried by the HEALER (core p. 90-91: First Aid Kit +1, Field Surgeon Kit +2,
 * Medical Supply Bag +1). Display only — the bonus is never added to the roll here, exactly like
 * the damage reduction hints in `damage.mjs`.
 *
 * @param {Actor|null} actor
 * @returns {Array<{name: string, text: string, type: string}>}
 */
export function collectHealingHints(actor) {
  const hints = [];

  for (const item of getItems(actor)) {
    if (item?.type !== "useful_item") continue;
    const text = stripHtml(item?.system?.description);
    if (!text || !HEAL_HINT_PATTERN.test(text)) continue;
    hints.push({ name: String(item?.name ?? ""), text, type: String(item?.type ?? "") });
  }

  return hints;
}

/**
 * What healing `amount` damage would do, without touching the actor (core p. 33: healing raises the
 * dice pool limit by the amount healed, capped at the dice pool maximum).
 *
 * @param {Actor|null} actor
 * @param {number} amount
 * @returns {{max: number, oldDamage: number, newDamage: number, oldLimit: number, newLimit: number,
 *   applied: number}}
 */
export function previewHeal(actor, amount) {
  const max = Math.max(0, toInteger(actor?.system?.dicepool?.max, 0));
  const oldDamage = Math.max(0, Math.min(max, toInteger(actor?.system?.damage, 0)));
  const requested = Math.max(0, toInteger(amount, 0));

  const newDamage = Math.max(0, oldDamage - requested);
  const oldLimit = Math.max(0, max - oldDamage);
  const newLimit = Math.max(0, max - newDamage);

  return {
    max,
    oldDamage,
    newDamage,
    oldLimit,
    newLimit,
    applied: oldDamage - newDamage,
  };
}

/**
 * What lowering (or raising) the horror limit by `delta` would do, without touching the actor.
 * @param {Actor|null} actor
 * @param {number} delta
 * @returns {{max: number, oldHorror: number, newHorror: number, applied: number}}
 */
export function previewHorrorLimit(actor, delta) {
  const max = Math.max(0, toInteger(actor?.system?.dicepool?.max, 0));
  const oldHorror = Math.max(0, toInteger(actor?.system?.horror, 0));
  const newHorror = Math.max(0, Math.min(max, oldHorror + toInteger(delta, 0)));

  return { max, oldHorror, newHorror, applied: newHorror - oldHorror };
}

/**
 * Removes an injury item from the actor.
 *
 * The item is deleted, not set to `active: false`: that flag exists to suspend an injury
 * temporarily (see `item-injury.mjs`), while healing ends it for good. Core p. 33 also asks for
 * every instance of a repeated injury to be healed separately, which deleting models correctly.
 *
 * Posts nothing — `applyHealingAndPost` reports the whole treatment in one card.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, injuryId: string, name: string,
 *   difficulty: number}>}
 */
export async function healInjury({ actor, injuryId, notify = true } = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.HEALING.Reasons.${reason}`));
    return { ok: false, reason, injuryId: String(injuryId ?? ""), name: "", difficulty: 0 };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const item = actor.items?.get?.(String(injuryId ?? ""));
  if (!item) return fail("INJURY_NOT_FOUND");
  if (item.type !== "injury") return fail("NOT_AN_INJURY");

  const name = String(item.name ?? "");
  const difficulty = getInjuryHealDifficulty(item);

  await actor.deleteEmbeddedDocuments("Item", [item.id]);

  return { ok: true, reason: null, injuryId: String(item.id ?? ""), name, difficulty };
}

/**
 * Applies healing to an actor and posts one summary card.
 *
 * Only `system.damage` is written: core p. 33 raises the dice pool LIMIT, it does not hand back
 * dice that were already spent. The freed slots stay empty until the pool is refreshed.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, ...}>}
 */
export async function applyHealingAndPost({
  actor,
  amount = 0,
  injuryIds = [],
  source = "chat",
  healerName = "",
  rollMode = "roll",
  notify = true,
} = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.HEALING.Reasons.${reason}`));
    return { ok: false, reason };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const healAmount = toInteger(amount, Number.NaN);
  if (!Number.isFinite(healAmount) || healAmount < 0) return fail("INVALID_AMOUNT");

  const ids = (Array.isArray(injuryIds) ? injuryIds : [injuryIds])
    .map(id => String(id ?? ""))
    .filter(Boolean);

  if (healAmount === 0 && ids.length === 0) return fail("NO_CHANGE");

  const preview = previewHeal(actor, healAmount);
  if (preview.applied > 0) await actor.update({ "system.damage": preview.newDamage });

  const healedInjuries = [];
  for (const injuryId of ids) {
    const result = await healInjury({ actor, injuryId, notify });
    if (result.ok) healedInjuries.push({ name: result.name, difficulty: result.difficulty });
  }

  const chatVars = {
    mode: "heal",
    actorName: actor.name,
    healerName: String(healerName ?? ""),
    hasHealer: !!String(healerName ?? "").trim(),
    amount: preview.applied,
    oldDamage: preview.oldDamage,
    newDamage: preview.newDamage,
    oldLimit: preview.oldLimit,
    newLimit: preview.newLimit,
    healedInjuries,
    hasInjuries: healedInjuries.length > 0,
  };

  const message = await createArkhamHorrorChatCard(
    {
      actor,
      template: TEMPLATE,
      chatVars,
      flags: {
        [SYSTEM_ID]: {
          ...chatVars,
          schemaVersion: 1,
          rollCategory: "healing",
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
    applied: preview.applied,
    oldDamage: preview.oldDamage,
    newDamage: preview.newDamage,
    oldLimit: preview.oldLimit,
    newLimit: preview.newLimit,
    healedInjuries,
    message,
  };
}

/**
 * Changes the horror limit by `delta` and posts a card.
 *
 * Core p. 38: a successful Introspection or Counseling lowers the limit by exactly 1, no matter how
 * many successes were rolled — callers pass `-1`, never the success count.
 *
 * `dicepool.horrorInPool` is pulled along: horror dice in the pool can never outnumber the limit,
 * and `prepareDerivedData` would otherwise silently reinterpret the stored value.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, ...}>}
 */
export async function adjustHorrorLimit(actor, delta, {
  source = "sheet",
  healerName = "",
  rollMode = "roll",
  postChat = true,
  notify = true,
} = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.HEALING.Reasons.${reason}`));
    return { ok: false, reason };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const step = toInteger(delta, Number.NaN);
  if (!Number.isFinite(step) || step === 0) return fail("INVALID_AMOUNT");

  const preview = previewHorrorLimit(actor, step);
  if (preview.applied === 0) return fail("NO_CHANGE");

  const dicePoolValue = Math.max(0, toInteger(actor.system?.dicepool?.value, 0));
  const oldHorrorInPool = Math.max(0, toNumber(actor.system?.dicepool?.horrorInPool, 0));
  const newHorrorInPool = Math.max(0, Math.min(oldHorrorInPool, dicePoolValue, preview.newHorror));

  await actor.update({
    "system.horror": preview.newHorror,
    "system.dicepool.horrorInPool": newHorrorInPool,
  });

  const chatVars = {
    mode: "horror",
    actorName: actor.name,
    healerName: String(healerName ?? ""),
    hasHealer: !!String(healerName ?? "").trim(),
    horrorDelta: preview.applied,
    oldHorror: preview.oldHorror,
    newHorror: preview.newHorror,
  };

  let message = null;
  if (postChat) {
    message = await createArkhamHorrorChatCard(
      {
        actor,
        template: TEMPLATE,
        chatVars,
        flags: {
          [SYSTEM_ID]: {
            ...chatVars,
            schemaVersion: 1,
            rollCategory: "healing",
            actorUuid: actor.uuid ?? "",
            source,
          },
        },
      },
      { rollMode }
    );
  }

  return {
    ok: true,
    reason: null,
    source,
    applied: preview.applied,
    oldHorror: preview.oldHorror,
    newHorror: preview.newHorror,
    oldHorrorInPool,
    newHorrorInPool,
    message,
  };
}

/* -------------------------------------------- */
/*  Healing rolls: target list and chat card     */
/* -------------------------------------------- */

function selfTarget(actor) {
  return {
    tokenUuid: "",
    actorUuid: String(actor?.uuid ?? ""),
    name: String(actor?.name ?? ""),
    img: String(actor?.img ?? ""),
  };
}

/**
 * Who a healing roll is aimed at.
 *
 * Introspection is always aimed at oneself (core p. 38). For the other three the current targeting
 * wins, and without a target the healer treats themself — core p. 33 explicitly allows that.
 *
 * @returns {Array<{tokenUuid: string, actorUuid: string, name: string, img: string}>}
 */
export function buildHealTargets({ actor, rollKind = "heal-damage" } = {}) {
  if (rollKind === "introspection") return [selfTarget(actor)];

  const targets = collectCurrentTargets();
  return targets.length > 0 ? targets : [selfTarget(actor)];
}

export function isHorrorRollKind(rollKind) {
  const kind = String(rollKind ?? "");
  return kind === "introspection" || kind === "counseling";
}

/**
 * Adds the "apply healing" section to the roll card of a healing roll.
 *
 * The card content has to be re-rendered instead of simply setting flags: `SkillRollWorkflow`
 * renders the template before this callback runs, and a chat message keeps its rendered HTML. The
 * flags of the card carry every template variable except the two dice HTML blobs (see
 * `SkillRollWorkflow.post`), which the caller hands in from the roll outcome — so the section can
 * live in `roll-result.hbs` rather than being assembled from strings in the hook.
 *
 * @returns {Promise<boolean>} whether the card could be decorated
 */
export async function decorateHealRollMessage({ message, actor, rollKind, outcome } = {}) {
  if (!message) return false;

  const flags = message.flags?.[SYSTEM_ID] ?? {};

  // The success count is deliberately NOT copied into a heal-specific flag: a reroll card inherits
  // these flags but recomputes `successCount` and `isSuccess`, so the button has to read those.
  const healData = {
    showHealSection: true,
    healRollKind: String(rollKind ?? ""),
    healIsHorror: isHorrorRollKind(rollKind),
    healTargets: buildHealTargets({ actor, rollKind }),
    healerName: String(actor?.name ?? ""),
    healerUuid: String(actor?.uuid ?? ""),
  };

  const chatVars = {
    ...flags,
    ...healData,
    diceRollHTML: outcome?.diceRollHTML ?? "",
    horrorDiceRollHTML: outcome?.horrorDiceRollHTML ?? "",
  };

  try {
    const content = await renderChatHtml(ROLL_RESULT_TEMPLATE, chatVars);
    await message.update({ content, [`flags.${SYSTEM_ID}`]: { ...flags, ...healData } });
    return true;
  } catch (e) {
    globalThis.ui?.notifications?.warn?.(t("ARKHAM_HORROR.HEALING.Reasons.CARD_UPDATE_FAILED"));
    return false;
  }
}

/* -------------------------------------------- */
/*  Recovery over time (GM tool)                 */
/* -------------------------------------------- */

/**
 * The three spans the GM can grant (core p. 33-34 and p. 38).
 *
 * Deliberately not tied to `game.time.worldTime`: almost no table keeps the world clock in sync
 * with the fiction, so the GM states the span instead of the system deriving it.
 */
export const RECOVERY_SPANS = Object.freeze(["night", "week", "twoWeeks"]);

/**
 * What a recovery span would change, without touching the actor.
 * @returns {{span: string, healsDamage: boolean, clearsHorror: boolean,
 *   injuries: Array<{id: string, name: string, difficulty: number}>, blocked:
 *   Array<{id: string, name: string, difficulty: number}>}}
 */
export function previewRecovery(actor, span = "night") {
  const key = RECOVERY_SPANS.includes(String(span)) ? String(span) : "night";
  const injuries = [];
  const blocked = [];

  if (key !== "night") {
    // One week heals injuries of difficulty 1, two weeks also the harder ones (core p. 34).
    const maxDifficulty = key === "week" ? 1 : 3;
    for (const item of getItems(actor)) {
      if (item?.type !== "injury") continue;
      const entry = {
        id: String(item.id ?? item._id ?? ""),
        name: String(item.name ?? ""),
        difficulty: getInjuryHealDifficulty(item),
      };
      if (!canInjuryHealNaturally(item)) blocked.push(entry);
      else if (entry.difficulty <= maxDifficulty) injuries.push(entry);
      else blocked.push(entry);
    }
  }

  return {
    span: key,
    healsDamage: true,
    // "Time Heals All Wounds" (core p. 38): a full quiet week drops the horror limit to 0.
    clearsHorror: key !== "night",
    injuries,
    blocked,
  };
}

/**
 * Applies a recovery span: pool limit back to maximum, naturally healing injuries removed and —
 * from a week on — the horror limit reset to 0.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, ...}>}
 */
export async function applyRecovery({
  actor,
  span = "night",
  source = "sheet",
  rollMode = "roll",
  notify = true,
} = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.HEALING.Reasons.${reason}`));
    return { ok: false, reason };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const plan = previewRecovery(actor, span);

  // Night's rest is already implemented as the dice pool refresh (core p. 33). postChat: false —
  // the recovery card below reports the same change plus everything else that happened.
  const refresh = await refreshDicepoolAndPost({
    actor,
    label: t("ARKHAM_HORROR.HEALING.Recovery.Chat.Label"),
    healDamage: true,
    postChat: false,
  });

  if (plan.injuries.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", plan.injuries.map(i => i.id));
  }

  const oldHorror = Math.max(0, toInteger(actor.system?.horror, 0));
  let newHorror = oldHorror;
  if (plan.clearsHorror && oldHorror > 0) {
    await actor.update({ "system.horror": 0, "system.dicepool.horrorInPool": 0 });
    newHorror = 0;
  }

  const chatVars = {
    mode: "recovery",
    actorName: actor.name,
    span: plan.span,
    spanLabel: t(`ARKHAM_HORROR.HEALING.Recovery.Span.${plan.span}`),
    healedDamage: refresh?.healedDamage ?? 0,
    hasHealedDamage: (refresh?.healedDamage ?? 0) > 0,
    healedInjuries: plan.injuries,
    hasInjuries: plan.injuries.length > 0,
    blockedInjuries: plan.blocked,
    hasBlocked: plan.blocked.length > 0,
    oldHorror,
    newHorror,
    clearedHorror: plan.clearsHorror && oldHorror !== newHorror,
  };

  const message = await createArkhamHorrorChatCard(
    {
      actor,
      template: TEMPLATE,
      chatVars,
      flags: {
        [SYSTEM_ID]: {
          ...chatVars,
          schemaVersion: 1,
          rollCategory: "healing",
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
    span: plan.span,
    healedDamage: refresh?.healedDamage ?? 0,
    healedInjuries: plan.injuries,
    blockedInjuries: plan.blocked,
    oldHorror,
    newHorror,
    message,
  };
}

/**
 * GM dialog for `applyRecovery`. Kept here next to the rule so the sheets only need one call.
 */
export async function openRecoveryDialog(actor, { source = "sheet" } = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return { ok: false, reason: "PERMISSION_DENIED" };

  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return applyRecovery({ actor, span: "night", source });

  const options = RECOVERY_SPANS
    .map(span => `<option value="${span}">${t(`ARKHAM_HORROR.HEALING.Recovery.Span.${span}`)}</option>`)
    .join("");

  const content = [
    `<p>${t("ARKHAM_HORROR.HEALING.Recovery.Dialog.Prompt", { actorName: actor.name })}</p>`,
    `<div class="form-group"><label for="arkham-recovery-span">${t("ARKHAM_HORROR.HEALING.Recovery.Dialog.Span")}</label>`,
    `<select id="arkham-recovery-span" name="span">${options}</select></div>`,
    `<p class="arkham-horror-hint">${t("ARKHAM_HORROR.HEALING.Recovery.Dialog.Note")}</p>`,
  ].join("");

  const span = await DialogV2.prompt({
    window: { title: t("ARKHAM_HORROR.HEALING.Recovery.Dialog.Title") },
    content,
    ok: {
      label: t("ARKHAM_HORROR.HEALING.Recovery.Dialog.Apply"),
      icon: "fa-solid fa-bed",
      callback: (_event, button) => String(button.form?.span?.value ?? "night"),
    },
    modal: true,
    rejectClose: false,
  });

  if (!span) return { ok: false, reason: "CANCELLED" };
  return applyRecovery({ actor, span, source });
}
