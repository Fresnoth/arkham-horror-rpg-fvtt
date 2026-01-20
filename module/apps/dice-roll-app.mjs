// ========================================================================
// Refactor v1 for DiceRollApp 
// As strictly UI gathering functions passing logic to SkillRollWorkflow with helper functions can then be extended for other roll types/dialogs/chat activation buttons etc..
// Injury/Trauma, Rerolls, d3 rolls.
// ========================================================================

import { SkillRollWorkflow } from "../rolls/skill-roll-workflow.mjs";
import {
  getApplicableKnacksForRoll,
  getMatchingKnacksForRoll,
  resolveSelectedKnacks,
  buildAppliedKnackEffects,
  spendKnackUses,
  isApplicableKnackSelection,
} from "../helpers/knacks.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class DiceRollApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;
    this.skillKey = options.skillKey;
    this.skillCurrent = options.skillCurrent;
    this.skillMax = options.skillMax;
    this.currentDicePool = options.currentDicePool;
    this.weaponToUse = options.weaponToUse;
    this.spellToUse = options.spellToUse;
    this.rollKind = options.rollKind ?? "complex";
    this.afterRoll = options.afterRoll;
    this.successesNeeded = options.successesNeeded;
    this.skillChoices = Array.isArray(options.skillChoices) ? options.skillChoices : null;

    // Single canonical "book" of parameters
    // (UI template context reads from here; workflow reads from here)
    this.rollState = {
        skillKey: this.skillKey,
        skillCurrent: this.skillCurrent,
        skillMax: this.skillMax,
        currentDicePool: this.currentDicePool,
        weaponToUse: this.weaponToUse,
        spellToUse: this.spellToUse,
        rollKind: this.rollKind,

        diceToUse: 0,
        penalty: 0,
        bonusDice: 0,
        resultModifier: 0,
        successesNeeded: 0,

        rollWithAdvantage: false,
        rollWithDisadvantage: false,
        modifierAdvantage: 0, // 0 = none, 1 = advantage, 2 = disadvantage, 3 = both, needed for the dialog and reactive updates

        // Knacks (prompt-selectable)
        selectedKnackIds: [],
        appliedKnacks: [],
        knackRerollAllowanceDice: 0,
    };

    if(options.spellToUse !== undefined && options.spellToUse !== null){ 
      options.successesNeeded = options.spellToUse.system.difficulty;
    }

    if (options.successesNeeded !== undefined) {
      this.rollState.successesNeeded = Number.parseInt(options.successesNeeded) || 0;
    }

    DiceRollApp.instance = this;

    // Used to prevent event listener accumulation across re-renders.
    this._renderAbortController = null;
  }

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "dice-roll-app",
    classes: ["dialog", "dice-roll-app"],
    tag: "div",
    window: {
        frame: true,
        title: "Dice Roll",
        icon: "fa-solid fa-book-atlas",
        positioned: true,
        resizable: true,
    },
    position: {
        width: 400,
        height: "auto",
    },
    actions: {
        clickedRoll: this.#handleClickedRoll,
        clickedIncreaseDicePool: this.#handleIncreaseDicePool,
        clickedDecreaseDicePool: this.#handleDecreaseDicePool,
        refreshKnackUses: this.#handleRefreshKnackUses,
    },
  };

  static async #handleRefreshKnackUses(event, target) {
    event.preventDefault();
    await this.refreshKnackUses(event, target);
  }

  /** @override */
  static PARTS = {
    dialog: {
        template: "systems/arkham-horror-rpg-fvtt/templates/dice-roll-app/dialog.hbs",
        scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'actor')) this.actor = options.actor;
    if (Object.prototype.hasOwnProperty.call(options, 'skillKey')) this.skillKey = options.skillKey;
    if (options.skillCurrent !== undefined) this.skillCurrent = options.skillCurrent;
    if (options.skillMax !== undefined) this.skillMax = options.skillMax;
    if (options.currentDicePool !== undefined) this.currentDicePool = options.currentDicePool;
    if (Object.prototype.hasOwnProperty.call(options, 'weaponToUse')) this.weaponToUse = options.weaponToUse;
    if (Object.prototype.hasOwnProperty.call(options, 'spellToUse')) this.spellToUse = options.spellToUse;
    this.rollKind = options.rollKind ?? "complex";
    this.afterRoll = options.afterRoll;
    this.successesNeeded = options.successesNeeded;
    this.skillChoices = Array.isArray(options.skillChoices) ? options.skillChoices : null;

    // Keep rollState in sync (single book)
    this.rollState.skillKey = this.skillKey;
    this.rollState.skillCurrent = this.skillCurrent;
    this.rollState.skillMax = this.skillMax;
    this.rollState.currentDicePool = this.currentDicePool;
    this.rollState.weaponToUse = this.weaponToUse;
    this.rollState.spellToUse = this.spellToUse;
    this.rollState.rollKind = this.rollKind ?? "complex";

    // Reset transient roll modifiers like your original code
    this.rollState.rollWithAdvantage = false;
    this.rollState.rollWithDisadvantage = false;
    this.rollState.modifierAdvantage = 0;
    this.rollState.diceToUse = 0;
    this.rollState.bonusDice = 0;
    this.rollState.penalty = 0;
    this.rollState.resultModifier = 0;
    this.rollState.successesNeeded = 0;

    // Reset knack selection
    this.rollState.selectedKnackIds = [];
    this.rollState.appliedKnacks = [];
    this.rollState.knackRerollAllowanceDice = 0;

    if(options.spellToUse !== undefined && options.spellToUse !== null){ 
      options.successesNeeded = options.spellToUse.system.difficulty;
    }

    if (options.successesNeeded !== undefined) {
      this.rollState.successesNeeded = Number.parseInt(options.successesNeeded) || 0;
    }

    // Reactions: exactly 1 die from pool (bonus dice and adv/disadv can add rolled dice without costing pool)
    if (this.rollState.rollKind === "reaction") {
      const pool = Number.parseInt(this.rollState.currentDicePool) || 0;
      this.rollState.diceToUse = pool > 0 ? 1 : 0;
    }
  }

  static getInstance(options = {}) {
    if (!DiceRollApp.instance) {
        DiceRollApp.instance = new DiceRollApp(options);
    }
    const instance = DiceRollApp.instance;
    instance.setOptions(options);
    return instance;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const rollKind = this.rollState.rollKind ?? "complex";
    const isReaction = rollKind === "reaction";

    const rollKindLabel = rollKind === "reaction"
      ? "Reaction"
      : rollKind === "tome-understand"
        ? "Tome: Understand"
        : rollKind === "tome-attune"
          ? "Tome: Attune"
          : "Complex";

    const isTomeUnderstand = rollKind === "tome-understand";
    const isSkillSelectable = isTomeUnderstand && Array.isArray(this.skillChoices) && this.skillChoices.length > 0;
    const skillChoices = isSkillSelectable
      ? this.skillChoices.map(key => ({
          key,
          label: game.i18n.localize(`ARKHAM_HORROR.SKILL.${key}`)
        }))
      : [];

    // Feed template from rollState (no separate context mapping logic)
    // We show *matching* knacks (even if out of uses) to reduce confusion,
    // but we only allow selecting those that are currently usable.
    const matchingKnacks = getMatchingKnacksForRoll({ actor: this.actor, rollState: this.rollState });
    const applicableKnacks = getApplicableKnacksForRoll({ actor: this.actor, rollState: this.rollState });
    const applicableIdSet = new Set(applicableKnacks.map(k => String(k.id)));
    const selectedSet = new Set((this.rollState.selectedKnackIds ?? []).map(String));

    const formatSigned = (n) => {
      const num = Number(n ?? 0) || 0;
      return num >= 0 ? `+${num}` : `${num}`;
    };

    const summarizeKnackModifier = (k) => {
      const mod = k?.system?.rollEffects?.modifier ?? {};
      const bonusDice = Number(mod.addBonusDice ?? 0) || 0;
      const resultMod = Number(mod.resultModifier ?? 0) || 0;
      const rerollAllow = Number(mod.rerollAllowanceDice ?? 0) || 0;
      const adv = Boolean(mod.advantage);
      const disadv = Boolean(mod.disadvantage);

      const parts = [];
      if (bonusDice) parts.push(`${formatSigned(bonusDice)}d`);
      if (resultMod) parts.push(`${formatSigned(resultMod)} result`);
      if (adv && !disadv) parts.push(`Adv`);
      if (disadv && !adv) parts.push(`Disadv`);
      if (adv && disadv) parts.push(`Adv+Disadv`);
      if (rerollAllow) parts.push(`${formatSigned(rerollAllow)} reroll`);

      return {
        bonusDice,
        resultMod,
        rerollAllow,
        adv,
        disadv,
        text: parts.length ? parts.join(", ") : "No roll changes",
      };
    };

    const canRefreshKnacks = !!(this.actor?.isOwner || game.user?.isGM);

    const knackChoices = matchingKnacks.map(k => {
      const usage = k.system?.usage ?? {};
      const freq = String(usage.frequency ?? "passive");
      const max = Number(usage.max ?? 0);
      const remaining = Number(usage.remaining ?? 0);

      const isLimited = !(freq === "passive" || freq === "unlimited");
      const usable = applicableIdSet.has(String(k.id));
      const exhausted = isLimited && remaining <= 0;
      const disabled = !usable;
      const checked = selectedSet.has(String(k.id)) && usable;

      const showRefresh = canRefreshKnacks && exhausted && max > 0;

      const effect = summarizeKnackModifier(k);

      const availabilityNote = exhausted ? "Out of uses" : null;

      return {
        id: k.id,
        name: k.name,
        tier: Number(k.system?.tier ?? 0),
        frequency: freq,
        max,
        remaining,
        disabled,
        checked,
        exhausted,
        showRefresh,
        availabilityNote,
        effect,
      };
    });

    // Live preview: what the currently selected knacks would change.
    const selectedKnacksForPreview = resolveSelectedKnacks({ actor: this.actor, selectedKnackIds: this.rollState.selectedKnackIds });
    const preview = buildAppliedKnackEffects({ selectedKnacks: selectedKnacksForPreview });
    const previewParts = [];
    if (preview.bonusDiceDelta) previewParts.push(`${formatSigned(preview.bonusDiceDelta)} bonus dice`);
    if (preview.resultModifierDelta) previewParts.push(`${formatSigned(preview.resultModifierDelta)} result modifier`);
    if (preview.advantage && !preview.disadvantage) previewParts.push(`Advantage`);
    if (preview.disadvantage && !preview.advantage) previewParts.push(`Disadvantage`);
    if (preview.advantage && preview.disadvantage) previewParts.push(`Advantage + Disadvantage`);
    if (preview.rerollAllowanceDice) previewParts.push(`${formatSigned(preview.rerollAllowanceDice)} reroll allowance dice`);

    const knackPreview = {
      hasSelection: (this.rollState.selectedKnackIds?.length ?? 0) > 0,
      text: previewParts.length ? previewParts.join(", ") : "No roll changes",
      bonusDiceDelta: preview.bonusDiceDelta,
      resultModifierDelta: preview.resultModifierDelta,
      advantage: preview.advantage,
      disadvantage: preview.disadvantage,
      rerollAllowanceDice: preview.rerollAllowanceDice,
    };

    return {
        ...context,

        actor: this.actor,
        rollKind,
        rollKindLabel,
        isReaction,
        skillKey: this.rollState.skillKey,
        skillCurrent: this.rollState.skillCurrent,
        skillMax: this.rollState.skillMax,
        currentDicePool: this.rollState.currentDicePool,
        diceToUse: this.rollState.diceToUse,
        penalty: this.rollState.penalty,
        bonus_dice: this.rollState.bonusDice, // bonus_dice match form field name so this populates 0 correctly now
        resultModifier: this.rollState.resultModifier,
        successesNeeded: this.rollState.successesNeeded,
        rollWithAdvantage: this.rollState.rollWithAdvantage,
        rollWithDisadvantage: this.rollState.rollWithDisadvantage,
        modifierAdvantage: this.rollState.modifierAdvantage,
        weaponToUse: this.rollState.weaponToUse,
        spellToUse: this.rollState.spellToUse,

        knackChoices,
        knackPreview,

        isSkillSelectable,
        skillChoices
    };
  }

  async refreshKnackUses(_event, target) {
    const itemId = target?.dataset?.itemId;
    if (!itemId) return;

    if (!(this.actor?.isOwner || game.user?.isGM)) {
      ui.notifications?.warn?.("You do not have permission to refresh knack uses for this actor.");
      return;
    }

    const knack = this.actor?.items?.get(itemId);
    if (!knack || knack.type !== "knack") return;

    const freq = String(knack.system?.usage?.frequency ?? "passive");
    if (freq === "passive" || freq === "unlimited") return;

    const max = Number(knack.system?.usage?.max ?? 0);
    if (max <= 0) return;

    await knack.update({ "system.usage.remaining": Math.max(0, max) });

    // Clearing selection avoids confusion if the user was expecting it to auto-apply.
    // (They can now check it, and the preview will update.)
    this.rollState.selectedKnackIds = [];
    this.render({ force: true });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    // Reset any previously-bound listeners for this render cycle.
    try {
      this._renderAbortController?.abort?.();
    } catch (e) {
      // ignore
    }
    this._renderAbortController = new AbortController();
    const signal = this._renderAbortController.signal;

    const form = this.element?.querySelector?.('form');
    if (!form) return;

    // Knack checkboxes: re-render so the user can see what will change.
    // (Must be attached even when there is no selectable Skill dropdown.)
    const knackBoxes = form.querySelectorAll('input[name="selectedKnackIds"]');
    for (const box of knackBoxes) {
      box.addEventListener('change', () => {
        this.updateRollStateWithForm(form);
        this.render({ force: true });
      }, { signal });
    }

    const skillSelect = form.querySelector('select[name="skillKey"]');
    if (!skillSelect) return;

    skillSelect.addEventListener('change', (event) => {
      // Preserve current transient UI state (diceToUse, bonus, etc.)
      this.updateRollStateWithForm(form);

      const selectedKey = String(event.target?.value ?? '');
      const allowed = Array.isArray(this.skillChoices) && this.skillChoices.includes(selectedKey);
      if (!allowed) return;

      // Overwrite Success on X+ from the actor's current skill when the skill changes
      const skillData = this.actor?.system?.skills?.[selectedKey];
      this.rollState.skillKey = selectedKey;
      this.rollState.skillCurrent = Number(skillData?.current ?? 0);
      this.rollState.skillMax = Number(skillData?.max ?? 0);

      this.render({ force: true });
    }, { signal });

  }

  static async #handleClickedRoll(event, target) {
    this.clickedRollCallback(event, target);
  }

  async clickedRollCallback(event, target) {
    event.preventDefault();
    const form = target.form;

    this.updateRollStateWithForm(form);

    // Validate knack selection against applicability (prevents stale selection bugs when the user changes skill).
    if (!isApplicableKnackSelection({ actor: this.actor, rollState: this.rollState, knackIds: this.rollState.selectedKnackIds })) {
      ui.notifications.warn("One or more selected Knacks no longer apply to this roll.");
      return;
    }

    // Apply selected knacks to rollState as deltas.
    const selectedKnacks = resolveSelectedKnacks({ actor: this.actor, selectedKnackIds: this.rollState.selectedKnackIds });
    const applied = buildAppliedKnackEffects({ selectedKnacks });

    // Store applied knacks for chat flags.
    this.rollState.appliedKnacks = applied.appliedKnacks;
    this.rollState.knackRerollAllowanceDice = applied.rerollAllowanceDice;

    // Apply deltas to numeric modifiers.
    this.rollState.bonusDice = Number(this.rollState.bonusDice ?? 0) + applied.bonusDiceDelta;
    this.rollState.resultModifier = Number(this.rollState.resultModifier ?? 0) + applied.resultModifierDelta;

    // Apply advantage/disadvantage if granted by a selected knack.
    if (applied.advantage) {
      this.rollState.rollWithAdvantage = true;
      this.rollState.modifierAdvantage = this.rollState.rollWithDisadvantage ? 3 : 1;
    }
    if (applied.disadvantage) {
      this.rollState.rollWithDisadvantage = true;
      this.rollState.modifierAdvantage = this.rollState.rollWithAdvantage ? 3 : 2;
    }

    if (this.rollState.rollKind === "reaction" && this.rollState.diceToUse !== 1) {
        ui.notifications.warn("Reaction rolls require 1 die from your pool.");
        return; // keep dialog open
    }

    // If Adv/Disadv selected, you must be rolling at least 1 die
    const baseDice = (this.rollState.diceToUse || 0) + (this.rollState.bonusDice || 0);
    if (this.rollState.modifierAdvantage !== 0 && baseDice <= 0) {
        ui.notifications.warn("Advantage/Disadvantage requires rolling at least 1 die.");
        return; // keep dialog open
    } else if (baseDice <= 0) {
        ui.notifications.warn("You must roll at least 1 die.");
        return; // keep dialog open
    }
    
    // Run workflow end-to-end (roll + update actor + post chat)
    const workflow = new SkillRollWorkflow();
    const result = await workflow.run({ actor: this.actor, state: this.rollState });

    // Spend Knack uses only after the roll is executed.
    await spendKnackUses({ actor: this.actor, selectedKnacks });

    if (typeof this.afterRoll === "function") {
      try {
        await this.afterRoll({
          actor: this.actor,
          state: this.rollState,
          ...result
        });
      } catch (e) {
        ui.notifications?.warn?.("Post-roll processing failed.");
      }
    }

    this.close();
  }

  updateRollStateWithForm(form){
    // If a skill selector is present, allow it to update skillKey.
    // NOTE: the default (non-selector) UI uses a read-only localized label, so do not read that.
    if (form.skillKey && form.skillKey.tagName === 'SELECT') {
      const selectedKey = String(form.skillKey.value ?? '');
      const allowed = Array.isArray(this.skillChoices)
        ? this.skillChoices.includes(selectedKey)
        : true;
      if (allowed) this.rollState.skillKey = selectedKey;
    }

    // Update rollState FROM UI once
    this.rollState.skillCurrent = Number.parseInt(form.skillCurrent.value) || 0;
    this.rollState.diceToUse = Number.parseInt(form.diceToUse.value) || 0;
    this.rollState.penalty = Number.parseInt(form.penalty.value) || 0;
    this.rollState.bonusDice = Number.parseInt(form.bonus_dice.value) || 0;
    this.rollState.resultModifier = Number.parseInt(form.resultModifier?.value) || 0;
    this.rollState.successesNeeded = Number.parseInt(form.difficulty.value) || 0;

    // Clamp reaction dice usage: exactly 1 die from pool if possible.
    if (this.rollState.rollKind === "reaction") {
        const pool = Number.parseInt(this.rollState.currentDicePool) || 0;
        this.rollState.diceToUse = pool > 0 ? 1 : 0;
    }

    // Advantage / disadvantage selector logic (same as original intent)
    this.rollState.modifierAdvantage = Number.parseInt(form.advantageModifier.value) || 0;
    if (this.rollState.modifierAdvantage === 1) {
        this.rollState.rollWithAdvantage = true;
        this.rollState.rollWithDisadvantage = false;
    } else if (this.rollState.modifierAdvantage === 2) {
        this.rollState.rollWithDisadvantage = true;
        this.rollState.rollWithAdvantage = false;
    } else if (this.rollState.modifierAdvantage === 3) {
        this.rollState.rollWithAdvantage = true;
        this.rollState.rollWithDisadvantage = true;
    } else {
        this.rollState.rollWithAdvantage = false;
        this.rollState.rollWithDisadvantage = false;
    }

    // Knack selection (checkbox list)
    const selected = [];
    try {
      const boxes = form.querySelectorAll('input[name="selectedKnackIds"]:checked');
      for (const b of boxes) {
        const id = String(b.value ?? "");
        if (id) selected.push(id);
      }
    } catch (e) {
      // ignore
    }
    this.rollState.selectedKnackIds = selected;
  }

  static async #handleIncreaseDicePool(event, target) {
    event.preventDefault();
    this.updateRollStateWithForm(event.target.form);

    if (this.rollState.rollKind === "reaction") {
      this.render({ force: true });
      return;
    }

    this.rollState.diceToUse += 1;
    if(this.rollState.diceToUse > this.rollState.currentDicePool){
      this.rollState.diceToUse = this.rollState.currentDicePool;
    }
    
    this.render({ force: true });
  }

  static async #handleDecreaseDicePool(event, target) {
    event.preventDefault();
    this.updateRollStateWithForm(event.target.form);

    if (this.rollState.rollKind === "reaction") {
      this.render({ force: true });
      return;
    }

    this.rollState.diceToUse -= 1;
    if(this.rollState.diceToUse < 0){
      this.rollState.diceToUse = 0;
    }

    this.render({ force: true });
  }
}