// Damage (core p. 31): "When a character suffers damage, they reduce their dice pool limit by one
// for each point of damage suffered." In system terms the limit is `dicepool.max - damage`, so a hit
// only ever writes `system.damage`.
//
// Injuries from weapons (core p. 30): successes >= the weapon's injury rating cause an injury;
// an injury rating of 0 means the weapon can never cause one.
//
// Horror (core p. 36) travels the same chain as damage: it is inflicted *on a target*, not on the
// roller, which is why `sufferHorror` is handled here and not in `rollEffects`. Suffering horror
// raises the horror limit by the same amount, capped at the dice pool maximum, and the horror dice
// currently in the pool are topped up along with it.
//
// Damage reduction (armour, knacks, relics — core p. 71/89/90/97/98) is rules text, not a number:
// "-1, minimum 1", "-2 and injury result -1", "may reduce to 0", "negates everything for N hits".
// `collectDamageHints` therefore only collects those texts for display; nothing is ever deducted
// automatically. See REGELN.md, section "Schadensreduktion".
//
// Everything except `applyDamageAndPost` is pure so the rules can be exercised without a live
// Foundry instance, following the style of `roll-engine.mjs`.

import { isWounded } from "./strain.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/damage-applied.hbs`;

// Compendium content is English, hand-written items are usually in the user's language, so both
// spellings are matched. Deliberately broad: a missing hint is worse than one hint too many.
const DAMAGE_HINT_PATTERN = /damage|schaden|d[eé]g[aâ]ts|da[ñn]o/i;

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
 * Damage a weapon deals on a hit (core p. 30). Weapons with 0 damage exist and are legal.
 * @param {object} options
 * @param {Item|null} [options.weapon]
 * @returns {number}
 */
export function getDefaultDamage({ weapon = null } = {}) {
  return Math.max(0, toInteger(weapon?.system?.damage, 0));
}

/**
 * Core p. 30: an attack causes an injury when its successes reach the weapon's injury rating.
 * A rating of 0 is the sheet's representation of "—" and never causes an injury.
 * @param {object} options
 * @param {number} [options.successes]
 * @param {Item|null} [options.weapon]
 * @returns {boolean}
 */
export function shouldInflictInjury({ successes = 0, weapon = null } = {}) {
  const rating = toInteger(weapon?.system?.injuryRating, 0);
  if (rating <= 0) return false;
  return toInteger(successes, 0) >= rating;
}

/**
 * What applying `amount` damage would do, without touching the actor.
 * @param {Actor|null} actor
 * @param {number} amount
 * @returns {{oldLimit: number, newLimit: number, oldDamage: number, newDamage: number,
 *   applied: number, max: number, wouldBeWounded: boolean}}
 */
export function previewDamage(actor, amount) {
  const max = Math.max(0, toInteger(actor?.system?.dicepool?.max, 0));
  const oldDamage = Math.max(0, Math.min(max, toInteger(actor?.system?.damage, 0)));
  const requested = toInteger(amount, 0);

  const newDamage = Math.max(0, Math.min(max, oldDamage + requested));
  const oldLimit = Math.max(0, max - oldDamage);
  const newLimit = Math.max(0, max - newDamage);

  return {
    max,
    oldDamage,
    newDamage,
    oldLimit,
    newLimit,
    applied: newDamage - oldDamage,
    // Core p. 31: a limit reduced to zero means wounded.
    wouldBeWounded: max > 0 && newLimit <= 0,
  };
}

/**
 * What gaining `amount` horror would do, without touching the actor.
 *
 * Core p. 36: the horror limit rises by the amount suffered and can never exceed the dice pool
 * maximum. The horror dice already in the pool rise with it — capped by the dice actually left in
 * the pool, because a die that has been spent cannot turn into a horror die.
 *
 * @param {Actor|null} actor
 * @param {number} amount
 * @param {object} [options]
 * @param {number|null} [options.dicePoolValue] Pool value to assume; defaults to the actor's.
 *   The apply dialog passes the value damage will leave behind.
 * @returns {{max: number, oldHorror: number, newHorror: number, applied: number,
 *   oldHorrorInPool: number, newHorrorInPool: number, atMax: boolean}}
 */
export function previewHorror(actor, amount, { dicePoolValue = null } = {}) {
  const max = Math.max(0, toInteger(actor?.system?.dicepool?.max, 0));
  const oldHorror = Math.max(0, Math.min(max, toInteger(actor?.system?.horror, 0)));
  const newHorror = Math.max(0, Math.min(max, oldHorror + toInteger(amount, 0)));

  const poolValue = dicePoolValue === null || dicePoolValue === undefined
    ? Math.max(0, toInteger(actor?.system?.dicepool?.value, 0))
    : Math.max(0, toInteger(dicePoolValue, 0));

  const oldHorrorInPool = Math.max(0, toNumber(actor?.system?.dicepool?.horrorInPool, 0));
  const gained = Math.max(0, newHorror - oldHorror);
  const newHorrorInPool = Math.max(0, Math.min(oldHorrorInPool + gained, poolValue, newHorror));

  return {
    max,
    oldHorror,
    newHorror,
    applied: newHorror - oldHorror,
    oldHorrorInPool,
    newHorrorInPool,
    // The limit is already at the pool maximum; further horror has no effect.
    atMax: max > 0 && newHorror >= max,
  };
}

/**
 * Horror an attack inflicts on its target, for pre-filling the apply dialog.
 *
 * Two sources, in order: an explicit number on the roll's chat flags (`targetHorror`), or the
 * spell's rules text. The compendium has no numeric horror field — `sufferHorror` is by far the
 * most common effect shape in the data but exists only as prose ("the target suffers 1 horror"),
 * so the text is matched. This is a pre-fill for an editable field, never an automatic effect.
 *
 * @param {object} [options]
 * @param {object|null} [options.flags] Chat flags of the attack card.
 * @param {Item|null} [options.spell]
 * @returns {number}
 */
export function getDefaultHorror({ flags = null, spell = null } = {}) {
  const explicit = toInteger(flags?.targetHorror, Number.NaN);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);

  const text = stripHtml(spell?.system?.specialRules ?? flags?.spellSpecialRules);
  if (!text) return 0;

  // Deliberately narrow: only the "suffers N horror" shape, so that "reduce horror by 1" and
  // similar sentences do not turn into damage.
  const match = /suffers?\s+(?:(\d+)\s+)?horror/i.exec(text);
  if (!match) return 0;
  return Math.max(0, toInteger(match[1], 1));
}

/**
 * All damage-reduction rules text carried by the target, for display in the apply dialog.
 *
 * Sources: every piece of protective equipment (`defensiveBenefit` + `specialRules`) and every
 * knack whose description mentions damage. The data model has no "worn" flag, so all protective
 * equipment the actor carries is listed — deciding what is actually worn is the GM's job anyway.
 *
 * @param {Actor|null} actor
 * @returns {Array<{name: string, text: string, type: string}>}
 */
export function collectDamageHints(actor) {
  const hints = [];

  for (const item of getItems(actor)) {
    const type = String(item?.type ?? "");
    const name = String(item?.name ?? "");

    if (type === "protective_equipment") {
      for (const field of ["defensiveBenefit", "specialRules"]) {
        const text = stripHtml(item?.system?.[field]);
        if (text) hints.push({ name, text, type });
      }
      continue;
    }

    if (type === "knack") {
      const text = stripHtml(item?.system?.description);
      if (text && DAMAGE_HINT_PATTERN.test(text)) hints.push({ name, text, type });
    }
  }

  return hints;
}

/**
 * Applies damage (and optionally horror) to an actor and posts a summary card.
 *
 * The dice pool value is written along with the damage: `prepareDerivedData` would clamp it anyway,
 * but persisting it keeps dice that fell out of the pool gone once the damage is healed again —
 * core p. 31 removes empty pool slots first and only then slots holding dice.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, ...}>}
 */
export async function applyDamageAndPost({
  actor,
  amount = 0,
  horror = 0,
  source = "chat",
  attackerName = "",
  weaponName = "",
  rollMode = "roll",
  notify = true,
} = {}) {
  const fail = (reason) => {
    if (notify) globalThis.ui?.notifications?.warn?.(t(`ARKHAM_HORROR.DAMAGE.Reasons.${reason}`));
    return { ok: false, reason };
  };

  if (!actor) return fail("ACTOR_REQUIRED");
  if (!(actor.isOwner || globalThis.game?.user?.isGM)) return fail("PERMISSION_DENIED");

  const damageAmount = toInteger(amount, Number.NaN);
  const horrorAmount = toInteger(horror, Number.NaN);
  if (!Number.isFinite(damageAmount) || !Number.isFinite(horrorAmount)) return fail("INVALID_AMOUNT");
  if (damageAmount === 0 && horrorAmount === 0) return fail("NO_CHANGE");

  const preview = previewDamage(actor, damageAmount);

  const oldDicePoolValue = Math.max(0, toInteger(actor.system?.dicepool?.value, 0));
  const newDicePoolValue = Math.min(oldDicePoolValue, preview.newLimit);

  // Damage is resolved first, so the horror dice are drawn against the pool that is actually left.
  const horrorPreview = previewHorror(actor, horrorAmount, { dicePoolValue: newDicePoolValue });
  const { oldHorror, newHorror, oldHorrorInPool, newHorrorInPool } = horrorPreview;

  const updateData = {
    "system.damage": preview.newDamage,
    "system.dicepool.value": newDicePoolValue,
    "system.dicepool.horrorInPool": newHorrorInPool,
  };
  if (newHorror !== oldHorror) updateData["system.horror"] = newHorror;

  await actor.update(updateData);

  const chatVars = {
    actorName: actor.name,
    attackerName: String(attackerName ?? ""),
    weaponName: String(weaponName ?? ""),
    hasAttacker: !!String(attackerName ?? "").trim(),
    hasWeapon: !!String(weaponName ?? "").trim(),
    amount: preview.applied,
    oldDamage: preview.oldDamage,
    newDamage: preview.newDamage,
    oldLimit: preview.oldLimit,
    newLimit: preview.newLimit,
    horror: newHorror - oldHorror,
    oldHorror,
    newHorror,
    hasHorror: newHorror !== oldHorror,
    // Reported so the table can see that part of the horror was swallowed by the cap (core p. 36).
    horrorRequested: horrorAmount,
    horrorCapped: horrorAmount > newHorror - oldHorror,
    horrorAtMax: horrorPreview.atMax,
    wounded: isWounded(actor),
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
          rollCategory: "damage",
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
    horrorApplied: newHorror - oldHorror,
    oldHorror,
    newHorror,
    oldHorrorInPool,
    newHorrorInPool,
    oldDamage: preview.oldDamage,
    newDamage: preview.newDamage,
    oldLimit: preview.oldLimit,
    newLimit: preview.newLimit,
    oldDicePoolValue,
    newDicePoolValue,
    wounded: chatVars.wounded,
    message,
  };
}
