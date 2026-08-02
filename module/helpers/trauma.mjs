// Traumas (core p. 37): a trauma is caused by ones *rolled on horror dice*. Several ones in the
// same roll can raise the severity of the result — see REGELN.md, section "Horror".
//
// The roll engine has always counted those ones as `horrorFailureCount`, but the number was only
// ever printed on the chat card. This module turns it into a rule.
//
// Rolling the trauma itself is deliberately NOT automatic. Like straining oneself, the GM decides
// when it happens, so all that is reported here is the trigger plus a button that opens the
// existing `InjuryTraumaRollApp` (table 2-2, modifier from the traumas the actor already has).
//
// Everything except `postTraumaSufferedCard` is pure, so the rules can be exercised without a live
// Foundry instance — same style as `roll-engine.mjs` and `damage.mjs`.

import { getTraumaRollModifierSummary } from "./injuries.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/trauma-suffered.hbs`;

/** World setting that switches the automatic reporting off. */
export const TRAUMA_REPORT_SETTING = "traumaFromHorrorOnes";

// Vehicles have no horror limit and therefore no horror dice; only characters and NPCs can be
// traumatised at all.
const TRAUMA_CAPABLE_TYPES = new Set(["character", "npc"]);

function toInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Ones rolled on horror dice in a finished roll.
 *
 * The per-die list is authoritative when present, because rerolls rewrite it in place; the
 * pre-computed `horrorFailureCount` is only the fallback for callers that hand over a bare
 * outcome (for example a chat card flag object).
 *
 * @param {object} outcome Result of `computeSkillOutcome`.
 * @returns {number}
 */
export function getHorrorOnesFromRoll(outcome) {
  const dice = Array.isArray(outcome?.finalDiceRollResults)
    ? outcome.finalDiceRollResults
    : (Array.isArray(outcome?.results) ? outcome.results : null);

  if (dice) {
    return dice.filter(d => !d?.isDropped && !!d?.isHorror && toInteger(d?.rawResult ?? d?.result, 0) === 1).length;
  }

  return Math.max(0, toInteger(outcome?.horrorFailureCount, 0));
}

/**
 * Does this roll cause a trauma, and how severe is it (core p. 37)?
 *
 * `previousHorrorOnes` exists for rerolls: a reroll card recomputes the whole dice array, so
 * without the previous count the same horror one would be reported again on every reroll. Horror
 * ones themselves cannot be rerolled, but a horror die that showed something else can come up 1.
 *
 * @param {object} outcome Result of `computeSkillOutcome`.
 * @param {object} [options]
 * @param {number} [options.previousHorrorOnes=0] Horror ones already reported for this roll chain.
 * @param {string} [options.actorType=""] Actor type; blank means "unknown, do not filter".
 * @returns {{triggered: boolean, horrorOnes: number, newHorrorOnes: number,
 *   severityModifier: number, reason: string|null}}
 */
export function getTraumaTriggerFromRoll(outcome, { previousHorrorOnes = 0, actorType = "" } = {}) {
  const horrorOnes = getHorrorOnesFromRoll(outcome);
  const previous = Math.max(0, toInteger(previousHorrorOnes, 0));
  const newHorrorOnes = Math.max(0, horrorOnes - previous);

  // Core p. 37: the first one causes the trauma, every further one makes it worse.
  const severityModifier = Math.max(0, horrorOnes - 1);

  const type = String(actorType ?? "");
  if (type && !TRAUMA_CAPABLE_TYPES.has(type)) {
    return { triggered: false, horrorOnes, newHorrorOnes: 0, severityModifier, reason: "ACTOR_TYPE_UNSUPPORTED" };
  }

  if (newHorrorOnes <= 0) {
    return { triggered: false, horrorOnes, newHorrorOnes: 0, severityModifier, reason: "NO_HORROR_ONES" };
  }

  return { triggered: true, horrorOnes, newHorrorOnes, severityModifier, reason: null };
}

/**
 * Modifier to pre-fill the trauma roll with: what the dialog derives from the traumas the actor
 * already carries, plus the severity gained from additional horror ones in this roll.
 *
 * @param {Actor|null} actor
 * @param {number} [severityModifier=0]
 * @returns {number}
 */
export function getSuggestedTraumaRollModifier(actor, severityModifier = 0) {
  const existing = Math.max(0, toInteger(getTraumaRollModifierSummary(actor)?.modifier, 0));
  return existing + Math.max(0, toInteger(severityModifier, 0));
}

/**
 * Whether the automatic reporting is switched on. Wrapped in try/catch so the helper stays usable
 * before `setupConfiguration` has run (and in tests, where `game` does not exist at all).
 *
 * @returns {boolean}
 */
export function isTraumaReportingEnabled() {
  try {
    const value = globalThis.game?.settings?.get?.(SYSTEM_ID, TRAUMA_REPORT_SETTING);
    return value === undefined ? true : Boolean(value);
  } catch (e) {
    return true;
  }
}

/**
 * Posts the "trauma suffered" card. It only *reports* — the roll itself waits for the button.
 *
 * @returns {Promise<ChatMessage|null>}
 */
export async function postTraumaSufferedCard({
  actor,
  trigger,
  source = "roll",
  rollMode = "roll",
} = {}) {
  if (!actor || !trigger?.triggered) return null;

  const severityModifier = Math.max(0, toInteger(trigger.severityModifier, 0));
  const chatVars = {
    actorName: actor.name,
    actorUuid: actor.uuid ?? "",
    horrorOnes: Math.max(0, toInteger(trigger.horrorOnes, 0)),
    newHorrorOnes: Math.max(0, toInteger(trigger.newHorrorOnes, 0)),
    severityModifier,
    hasSeverity: severityModifier > 0,
  };

  return createArkhamHorrorChatCard(
    {
      actor,
      template: TEMPLATE,
      chatVars,
      flags: {
        [SYSTEM_ID]: {
          ...chatVars,
          schemaVersion: 1,
          rollCategory: "trauma",
          source,
        },
      },
    },
    { rollMode }
  );
}
