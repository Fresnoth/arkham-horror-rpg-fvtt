import {
    rollD6,
    calculatePoolsAndThresholds,
    collectTaggedResults,
    applyAdvantageDisadvantageDrop,
    computeSkillOutcome,
    resolveRollAftermath,
} from "../helpers/roll-engine.mjs";
import { computeShowRollDetails } from "../helpers/roll-details.mjs";
import { collectCurrentTargets, getReactionSkillForAttack } from "../helpers/defend.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";
import { spendRollCost } from "../api/resources/index.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

export class SkillRollWorkflow {
  async plan({ actor, state }) {
    return calculatePoolsAndThresholds({
      actor,
      skillCurrent: state.skillCurrent,
      currentDicePool: state.currentDicePool,
      diceToUse: state.diceToUse,
      selectedHorrorDice: state.horrorDiceToUse,
      penalty: state.penalty,
      bonusDice: state.bonusDice,
      resultModifier: state.resultModifier,
      rollWithAdvantage: state.rollWithAdvantage,
      rollWithDisadvantage: state.rollWithDisadvantage,
    });
  }

  async execute({ actor, plan }) {
    // Roll horror separately so chat rendering can keep normal and horror dice visually distinct.
    const dicePromises = [];
    const horror = plan.horrorDiceToRoll > 0
      ? await rollD6({ actor, numDice: plan.horrorDiceToRoll, dicePromises })
      : null;

    const normal = await rollD6({ actor, numDice: plan.diceToRoll, dicePromises });

    await Promise.all(dicePromises);
    return { normal, horror };
  }

  processSpell({ state, outcome }) {
    let result = { spellUsageSuccess: false };
    if (state.spellToUse) {
      result.spellUuid = state.spellToUse.uuid;
      if (outcome.successCount >= state.spellToUse.system.difficulty) {
        result.spellUsageSuccess = true;
      }
      result.spellSpecialRules = state.spellToUse.system.specialRules;
      result.spellUsed = state.spellToUse;
    }
    return result;
  }

  async processWeapon({ state, outcome }) {
    // Capture ammo snapshot up-front so rerolls and chat metadata stay consistent.
    let result = { weaponUsageSuccess: false, weaponAmmoUsed: false };
    if (state.weaponToUse) {
      const ammo = state.weaponToUse.system?.ammunition;
      const ammoMax = Number(ammo?.max ?? 0);
      const ammoOld = Number(ammo?.current ?? 0);
      result.weaponUuid = state.weaponToUse.uuid;
      result.weaponAmmoOld = ammoOld;
      result.weaponAmmoNew = ammoOld;
      result.weaponAmmoSpendReason = null;

      if (outcome.successCount > 0) {
        result.weaponUsageSuccess = true;
        result.weaponDamage = state.weaponToUse.system.damage;
      } else {
        result.weaponDamage = 0;
      }
      if (outcome.successCount >= state.weaponToUse.system.injuryRating && state.weaponToUse.system.injuryRating > 0) {
        result.weaponInflictInjury = true;
      }
      result.weaponSpecialRules = state.weaponToUse.system.specialRules;
      result.weaponUsed = state.weaponToUse;

      if (ammo?.reloadAfterUsage) {
        // Weapon property: force full reload after each usage.
        result.weaponAmmoUsed = true;
        result.weaponAmmoSpendReason = "reloadAfterUsage";
        result.weaponAmmoNew = 0;
        try {
          await state.weaponToUse.update({ "system.ammunition.current": 0 });
        } catch (_error) {
          result.weaponAmmoSyncFailed = true;
        }
      } else if (ammo?.decreaseAfterUsage) {
        // Weapon property: consume one ammo per usage regardless of final die faces.
        result.weaponAmmoUsed = true;
        result.weaponAmmoSpendReason = "decreaseAfterUsage";
        result.weaponAmmoNew = Math.max(0, ammoOld - 1);
        try {
          await state.weaponToUse.update({ "system.ammunition.current": result.weaponAmmoNew });
        } catch (_error) {
          result.weaponAmmoSyncFailed = true;
        }
      } else {
        // Core Rulebook p.81: if the final kept roll contains a natural 1, expend one ammo.
        const keptDice = (outcome.finalDiceRollResults ?? []).filter(d => !d.isDropped);
        const hasFinalOne = keptDice.some(d => d.result === 1);
        if (hasFinalOne && ammoMax > 0) {
          result.weaponAmmoUsed = true;
          result.weaponAmmoSpendReason = "nat1";
          result.weaponAmmoNew = Math.max(0, ammoOld - 1);
          try {
            await state.weaponToUse.update({ "system.ammunition.current": result.weaponAmmoNew });
          } catch (_error) {
            result.weaponAmmoSyncFailed = true;
          }
        }
      }
    } else {
      result.weaponUsed = false;
    }

    return result;
  }

  processTargets({ state }) {
    const empty = { targets: [], attackSkill: null, defendSkillKey: null };

    const defendSkillKey = getReactionSkillForAttack({
      weapon: state.weaponToUse,
      spell: state.spellToUse,
    });
    if (!defendSkillKey) return empty;

    // Targets are read here (and not in the dialog) because the workflow runs on the
    // attacking client, where `game.user.targets` is still the live selection.
    const targets = collectCurrentTargets();
    if (targets.length === 0) return empty;

    return {
      targets,
      attackSkill: String(state.weaponToUse?.system?.skill ?? ""),
      defendSkillKey,
    };
  }

  async computeOutcome({ state, plan, exec }) {
    const diceRollResults = collectTaggedResults({
      normalResults: exec.normal.results,
      horrorResults: exec.horror ? exec.horror.results : [],
    });

    applyAdvantageDisadvantageDrop(diceRollResults, {
      rollWithAdvantage: plan.rollWithAdvantage,
      rollWithDisadvantage: plan.rollWithDisadvantage,
    });

    let outcome = computeSkillOutcome(diceRollResults, {
      successOn: plan.successOn,
      penalty: plan.penalty,
      successesNeeded: state.successesNeeded,
      resultModifier: plan.resultModifier,
      addSuccesses: state.addSuccesses,
    });

    outcome = { ...outcome, ...await this.processWeapon({ state, outcome }) };
    outcome = { ...outcome, ...this.processSpell({ state, outcome }) };
    outcome = { ...outcome, ...this.processTargets({ state }) };

    return {
      ...outcome,
      successOn: plan.successOn,
      diceToUse: plan.diceToUse,
      horrorDiceToRoll: plan.horrorDiceToRoll,
      penalty: plan.penalty,
      bonusDice: plan.bonusDice,
      resultModifier: plan.resultModifier,
      successesNeeded: Number.parseInt(state.successesNeeded) || 0,
      rollWithAdvantage: plan.rollWithAdvantage,
      rollWithDisadvantage: plan.rollWithDisadvantage,
      horrorDiceUsed: plan.horrorDiceToRoll > 0,
      diceRollHTML: exec.normal.html,
      horrorDiceRollHTML: exec.horror ? exec.horror.html : "",
    };
  }

  async applyEffects({ actor, state, outcome }) {
    // Resource spend is authoritative: if dicepool spend fails, do not post the roll.
    const spendOutcome = await spendRollCost(actor, {
      totalDiceCost: outcome.diceToUse,
      horrorDiceCost: outcome.horrorDiceToRoll,
      context: state?.rollKind ?? "complex",
      source: "workflow",
    });

    if (!spendOutcome?.ok) {
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.Warnings.RollSpendFailed"));
      const current = Number(actor.system?.dicepool?.value ?? 0);
      outcome.oldDicePoolValue = current;
      outcome.newDicePoolValue = current;
      return {
        ok: false,
        reason: String(spendOutcome?.reason ?? "ROLL_SPEND_FAILED"),
      };
    }

    outcome.oldDicePoolValue = Number(spendOutcome.before?.dicepool ?? actor.system?.dicepool?.value ?? 0);
    outcome.newDicePoolValue = Number(spendOutcome.after?.dicepool ?? actor.system?.dicepool?.value ?? 0);
    return { ok: true, reason: null };
  }

  buildChat({ state, outcome }) {
    const template = "systems/arkham-horror-rpg-fvtt/templates/chat/roll-result.hbs";

    const rollKind = String(state?.rollKind ?? "complex");
    const rollKindLabel = rollKind === "reaction"
      ? "Reaction"
      : rollKind === "tome-understand"
        ? "Tome: Understand"
        : rollKind === "tome-attune"
          ? "Tome: Attune"
          : "Complex";

    const showRollDetails = computeShowRollDetails(outcome);

    const targets = Array.isArray(outcome.targets) ? outcome.targets : [];
    const defendSkillKey = outcome.defendSkillKey ?? null;

    const chatData = {
      rollCategory: "skill",
      rollKind,
      rollKindLabel,
      showRollDetails,
      diceRollHTML: outcome.diceRollHTML,
      horrorDiceRollHTML: outcome.horrorDiceRollHTML,
      successOn: outcome.successOn,
      diceToUse: outcome.diceToUse,
      results: outcome.finalDiceRollResults,
      successCount: outcome.successCount,
      failureCount: outcome.failureCount,
      skillUsed: game.i18n.localize(`ARKHAM_HORROR.SKILL.${state.skillKey}`),
      // Kept alongside the label so reroll cards can hand the raw key back to the aftermath.
      skillKey: String(state?.skillKey ?? ""),
      newDicePoolValue: outcome.newDicePoolValue,
      oldDicePoolValue: outcome.oldDicePoolValue,
      horrorFailureCount: outcome.horrorFailureCount,
      horrorDiceToRoll: outcome.horrorDiceToRoll,
      isSuccess: outcome.isSuccess,
      penalty: outcome.penalty,
      bonusDice: outcome.bonusDice,
      resultModifier: outcome.resultModifier,
      successesNeeded: outcome.successesNeeded,
      rollWithAdvantage: outcome.rollWithAdvantage,
      rollWithDisadvantage: outcome.rollWithDisadvantage,
      horrorDiceUsed: outcome.horrorDiceUsed,
      weaponUsed: outcome.weaponUsed,
      weaponUsageSuccess: outcome.weaponUsageSuccess,
      weaponDamage: outcome.weaponDamage,
      weaponInflictInjury: outcome.weaponInflictInjury,
      weaponSpecialRules: outcome.weaponSpecialRules,
      weaponHasSpecialRules: outcome.weaponSpecialRules && outcome.weaponSpecialRules.trim() !== "",
      weaponUuid: outcome.weaponUuid,
      weaponAmmoOld: outcome.weaponAmmoOld,
      weaponAmmoNew: outcome.weaponAmmoNew,
      weaponAmmoSpendReason: outcome.weaponAmmoSpendReason,
      spellUsed: outcome.spellUsed,
      spellUuid: outcome.spellUuid,
      spellSpecialRules: outcome.spellSpecialRules,
      spellHasSpecialRules: outcome.spellSpecialRules && outcome.spellSpecialRules.trim() !== "",

      appliedKnacks: Array.isArray(state?.appliedKnacks) ? state.appliedKnacks : [],
      knackRerollAllowanceDice: Number(state?.knackRerollAllowanceDice ?? 0) || 0,

      // Item roll effects. `addedSuccesses` is already contained in `successCount`; a reroll of this
      // card reads it back so the granted success is not lost. The three `effect*` values change
      // nothing about the roll and are here for the apply dialogs (core p. 33-34, p. 38).
      addedSuccesses: Number(outcome.addedSuccesses ?? 0) || 0,
      effectHealDamage: Number(state?.effectHealDamage ?? 0) || 0,
      effectHealInjury: Boolean(state?.effectHealInjury),
      effectReduceHorrorLimit: Number(state?.effectReduceHorrorLimit ?? 0) || 0,

      // Attack -> target -> defend (core p.30)
      targets,
      attackSkill: outcome.attackSkill ?? null,
      defendSkillKey,
      defendSkillLabel: defendSkillKey
        ? game.i18n.localize(`ARKHAM_HORROR.SKILL.${defendSkillKey}`)
        : "",
      attackHit: Boolean(outcome.weaponUsageSuccess),
      showDefendSection: !!defendSkillKey && targets.length > 0,
      defenses: [],
    };

    return { template, chatData };
  }

  async post({ actor, state, outcome }) {
    const { template, chatData } = this.buildChat({ state, outcome });
    const { diceRollHTML, horrorDiceRollHTML, ...flagsData } = chatData;
    const flags = {
      [SYSTEM_ID]: flagsData,
    };

    return createArkhamHorrorChatCard({ actor, template, chatVars: chatData, flags });
  }

  async run({ actor, state }) {
    const plan = await this.plan({ actor, state });
    const exec = await this.execute({ actor, plan });
    const outcome = await this.computeOutcome({ state, plan, exec });
    const effects = await this.applyEffects({ actor, state, outcome });
    if (!effects?.ok) {
      return {
        ok: false,
        reason: effects?.reason ?? "ROLL_SPEND_FAILED",
        plan,
        exec,
        outcome,
      };
    }

    const posted = await this.post({ actor, state, outcome });

    // Result-triggered effects run after the roll card, so the cause is always above the
    // consequence in the log.
    const aftermath = await resolveRollAftermath({
      actor,
      outcome,
      rollKind: state?.rollKind ?? "complex",
      skillKey: state?.skillKey ?? "",
      source: "skill-roll",
    });

    // `message` is the created ChatMessage document; callers (e.g. the defend hooks)
    // need a stable handle to attach follow-up flags to.
    return { ok: true, reason: null, plan, exec, outcome, aftermath, ...posted, message: posted };
  }
}