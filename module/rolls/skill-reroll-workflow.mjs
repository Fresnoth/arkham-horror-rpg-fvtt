import { rollD6, computeSkillOutcome } from "../helpers/roll-engine.mjs";
import { computeShowRollDetails } from "../helpers/roll-details.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function resolveActorFromMessage(message) {
  try {
    const a = ChatMessage.getSpeakerActor?.(message?.speaker);
    if (a) return a;
  } catch (e) {
    // ignore
  }
  const actorId = message?.speaker?.actor;
  return actorId ? game.actors.get(actorId) : null;
}

function canUserReroll({ actor }) {
  if (game.user?.isGM) return true;
  return !!actor?.isOwner;
}

function getKeptDice(dice) {
  return (Array.isArray(dice) ? dice : []).filter((d) => !d?.isDropped);
}

export class SkillRerollWorkflow {
  constructor({ actor, message, rollFlags, selectedIndices }) {
    this.actor = actor;
    this.message = message;
    this.rollFlags = rollFlags;
    this.selectedIndices = Array.isArray(selectedIndices) ? selectedIndices : [];
  }

  static fromMessage({ message, actor = null, selectedIndices = [] } = {}) {
    const rollFlags = message?.flags?.[SYSTEM_ID];
    if (!rollFlags || rollFlags.rollCategory !== "skill") {
      throw new Error("That chat card cannot be rerolled.");
    }

    const resolvedActor = actor ?? resolveActorFromMessage(message);
    if (!resolvedActor) {
      throw new Error("Could not resolve the actor for this roll.");
    }

    if (!canUserReroll({ actor: resolvedActor })) {
      throw new Error("You do not have permission to reroll this roll.");
    }

    return new SkillRerollWorkflow({
      actor: resolvedActor,
      message,
      rollFlags,
      selectedIndices,
    });
  }

  plan() {
    const dice = Array.isArray(this.rollFlags?.results) ? structuredClone(this.rollFlags.results) : [];

    const chosen = new Set(
      (Array.isArray(this.selectedIndices) ? this.selectedIndices : []).map((n) => Number(n)).filter(Number.isFinite)
    );

    const isSelectable = (d) => {
      const raw = Number(d?.rawResult ?? 0);
      return !d?.isDropped && !(d?.isHorror && raw === 1);
    };

    const targets = dice
      .map((d, idx) => ({ d, idx }))
      .filter(({ d, idx }) => chosen.has(idx) && isSelectable(d));

    if (targets.length === 0) {
      throw new Error("No selectable dice were chosen.");
    }

    const normalIndices = targets.filter((x) => !x.d.isHorror).map((x) => x.idx);
    const horrorIndices = targets.filter((x) => !!x.d.isHorror).map((x) => x.idx);

    return { dice, normalIndices, horrorIndices };
  }

  async execute({ plan }) {
    const dicePromises = [];

    const normalRoll = plan.normalIndices.length > 0
      ? await rollD6({ actor: this.actor, numDice: plan.normalIndices.length, dicePromises })
      : null;

    const horrorRoll = plan.horrorIndices.length > 0
      ? await rollD6({ actor: this.actor, numDice: plan.horrorIndices.length, dicePromises })
      : null;

    await Promise.all(dicePromises);
    return { normalRoll, horrorRoll };
  }

  computeOutcome({ plan, exec }) {
    if (exec.normalRoll) {
      plan.normalIndices.forEach((idx, i) => {
        const raw = Number(exec.normalRoll.results?.[i] ?? 0);
        plan.dice[idx] = { ...plan.dice[idx], rawResult: raw, isNat1: raw === 1, isNat6: raw === 6 };
      });
    }

    if (exec.horrorRoll) {
      plan.horrorIndices.forEach((idx, i) => {
        const raw = Number(exec.horrorRoll.results?.[i] ?? 0);
        plan.dice[idx] = { ...plan.dice[idx], rawResult: raw, isNat1: raw === 1, isNat6: raw === 6 };
      });
    }

    return computeSkillOutcome(plan.dice, {
      successOn: this.rollFlags.successOn,
      penalty: this.rollFlags.penalty,
      successesNeeded: this.rollFlags.successesNeeded,
      resultModifier: this.rollFlags.resultModifier,
    });
  }

  async applyEffects({ outcome }) {
    await this.#reconcileWeaponAmmo({ newDice: outcome.finalDiceRollResults });
  }

  async #reconcileWeaponAmmo({ newDice }) {
    const weaponUuid = this.rollFlags?.weaponUuid;
    const spendReason = this.rollFlags?.weaponAmmoSpendReason;

    // Only reconcile nat1-based ammo changes in v1.
    if (!weaponUuid || spendReason !== "nat1") return;

    const weapon = await fromUuid(weaponUuid);
    if (!weapon || weapon?.parent?.id !== this.actor?.id) return;

    const ammo = weapon.system?.ammunition;
    const ammoMax = Number(ammo?.max ?? 0);
    if (ammoMax <= 0) return;

    const ammoOld = Number(this.rollFlags?.weaponAmmoOld ?? 0);
    const ammoSpent = Math.max(0, ammoOld - 1);

    const kept = getKeptDice(newDice);
    const hasFinalOne = kept.some((d) => Number(d?.result ?? 0) === 1);

    // Safe update: only touch ammo if it's still at one of the expected states produced by this roll chain.
    const current = Number(weapon.system?.ammunition?.current ?? 0);
    if (current !== ammoOld && current !== ammoSpent) return;

    const expectedAfter = hasFinalOne ? ammoSpent : ammoOld;
    if (expectedAfter !== current) {
      await weapon.update({ "system.ammunition.current": expectedAfter });
    }
  }

  async buildChat({ outcome }) {
    const chatData = {
      ...this.rollFlags,

      // explicit reroll fields
      isReroll: true,
      rerollSourceMessageId: this.message.id,

      // outcome fields
      results: outcome.finalDiceRollResults,
      successCount: outcome.successCount,
      failureCount: outcome.failureCount,
      horrorFailureCount: outcome.horrorFailureCount,
      isSuccess: outcome.isSuccess,

      // chat-only rerolls should not change dicepool
      oldDicePoolValue: this.rollFlags.oldDicePoolValue,
      newDicePoolValue: this.rollFlags.newDicePoolValue,

      // keep these for compatibility
      diceRollHTML: "",
      horrorDiceRollHTML: "",
    };

    chatData.showRollDetails = computeShowRollDetails(chatData);

    // Optional recompute of weapon/spell display if UUIDs are present.
    try {
      if (this.rollFlags?.weaponUuid) {
        const weapon = await fromUuid(this.rollFlags.weaponUuid);
        if (weapon) {
          const successCount = Number(outcome?.successCount ?? 0);
          const injuryRating = Number(weapon.system?.injuryRating ?? 0);

          chatData.weaponUsed = weapon;
          chatData.weaponUsageSuccess = successCount > 0;
          chatData.weaponDamage = successCount > 0 ? Number(weapon.system?.damage ?? 0) : 0;
          chatData.weaponInflictInjury = injuryRating > 0 && successCount >= injuryRating;
          chatData.weaponSpecialRules = weapon.system?.specialRules;
          chatData.weaponHasSpecialRules = Boolean(
            weapon.system?.specialRules && String(weapon.system?.specialRules).trim() !== ""
          );
        }
      }
    } catch (e) {
      // ignore
    }

    try {
      if (this.rollFlags?.spellUuid) {
        const spell = await fromUuid(this.rollFlags.spellUuid);
        if (spell) {
          const successCount = Number(outcome?.successCount ?? 0);
          const difficulty = Number(spell.system?.difficulty ?? 0);

          chatData.spellUsed = spell;
          chatData.spellUsageSuccess = successCount >= difficulty;
          chatData.spellSpecialRules = spell.system?.specialRules;
          chatData.spellHasSpecialRules = Boolean(
            spell.system?.specialRules && String(spell.system?.specialRules).trim() !== ""
          );
        }
      }
    } catch (e) {
      // ignore
    }

    const template = "systems/arkham-horror-rpg-fvtt/templates/chat/roll-result.hbs";
    const { diceRollHTML, horrorDiceRollHTML, ...flagsData } = chatData;
    const flags = { [SYSTEM_ID]: flagsData };

    return { template, chatData, flags };
  }

  async post({ built }) {
    return createArkhamHorrorChatCard({
      actor: this.actor,
      template: built.template,
      chatVars: built.chatData,
      flags: built.flags,
    });
  }

  async run() {
    const plan = this.plan();
    const exec = await this.execute({ plan });
    const outcome = this.computeOutcome({ plan, exec });
    await this.applyEffects({ outcome });
    const built = await this.buildChat({ outcome });
    return this.post({ built });
  }
}
