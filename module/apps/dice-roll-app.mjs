// ========================================================================
// Refactor v1 for DiceRollApp 
// As strictly UI gathering functions passing logic to SkillRollWorkflow with helper functions can then be extended for other roll types/dialogs/chat activation buttons etc..
// Injury/Trauma, Rerolls, d3 rolls.
// ========================================================================

import { SkillRollWorkflow } from "../rolls/skill-roll-workflow.mjs";

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
    };

    if(options.spellToUse !== undefined && options.spellToUse !== null){ 
      options.successesNeeded = options.spellToUse.system.difficulty;
    }

    if (options.successesNeeded !== undefined) {
      this.rollState.successesNeeded = Number.parseInt(options.successesNeeded) || 0;
    }

    DiceRollApp.instance = this;
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
    },
  };

  /** @override */
  static PARTS = {
    dialog: {
        template: "systems/arkham-horror-rpg-fvtt/templates/dice-roll-app/dialog.hbs",
        scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;
    if (options.skillKey) this.skillKey = options.skillKey;
    if (options.skillCurrent !== undefined) this.skillCurrent = options.skillCurrent;
    if (options.skillMax !== undefined) this.skillMax = options.skillMax;
    if (options.currentDicePool !== undefined) this.currentDicePool = options.currentDicePool;
    if(options.weaponToUse !== undefined) this.weaponToUse = options.weaponToUse;
    if(options.spellToUse !== undefined) this.spellToUse = options.spellToUse;
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

        isSkillSelectable,
        skillChoices
    };
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element?.querySelector?.('form');
    if (!form) return;

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
    });
  }

  static async #handleClickedRoll(event, target) {
    this.clickedRollCallback(event, target);
  }

  async clickedRollCallback(event, target) {
    event.preventDefault();
    const form = target.form;

    this.updateRollStateWithForm(form);

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