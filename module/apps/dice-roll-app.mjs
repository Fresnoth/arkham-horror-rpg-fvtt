// ========================================================================
// Refactor v1 for DiceRollApp 
// As strictly UI gathering functions passing logic to SkillRollWorkflow with helper functions can then be extended for other roll types/dialogs/chat activation buttons etc..
// Injury/Trauma, Rerolls, d3 rolls.
// ========================================================================

import { SkillRollWorkflow } from "../rolls/skill-roll-workflow.mjs";
import {
  getApplicableEffectItemsForRoll,
  getMatchingEffectItemsForRoll,
  resolveSelectedEffectItems,
  buildAppliedItemEffects,
  spendItemUses,
  isApplicableEffectItemSelection,
} from "../helpers/knacks.mjs";
import { ROLL_EFFECT_ITEM_TYPES } from "../data/fields/roll-effects.mjs";
import { getInjuryImpactForSkillRoll } from "../helpers/injuries.mjs";
import { getHorrorSpendBounds } from "../helpers/dicepool-state.mjs";
import { HEAL_ROLL_KINDS } from "../helpers/healing.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const HEAL_ROLL_KIND_SET = new Set(HEAL_ROLL_KINDS);
const EFFECT_ITEM_TYPE_SET = new Set(ROLL_EFFECT_ITEM_TYPES);

// English fallbacks for the new roll-effect modifiers, used until the strings in
// `lang/_pending-rolleffects.json` are merged into `lang/*.json`.
const ROLL_EFFECT_FALLBACKS = {
  AddSuccesses: "{count} success",
  HealDamage: "heals {count} damage",
  HealInjury: "injury difficulty -1",
  ReduceHorrorLimit: "horror limit -{count}",
};

function tRollEffect(key, data = {}) {
  const full = `ARKHAM_HORROR.ROLLEFFECTS.${key}`;
  if (game?.i18n?.has?.(full)) return game.i18n.format(full, data);

  return String(ROLL_EFFECT_FALLBACKS[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => (name in data ? String(data[name]) : match));
}

// English fallbacks in the style of the other roll kinds, used until the healing strings are
// merged into `lang/*.json` (they currently live in `lang/_pending-healing.json`).
const ROLL_KIND_LABELS = {
  reaction: "Reaction",
  "tome-understand": "Tome: Understand",
  "tome-attune": "Tome: Attune",
  "heal-damage": "Healing: Damage",
  "heal-injury": "Healing: Injury",
  introspection: "Introspection",
  counseling: "Counseling",
};

function getRollKindLabel(rollKind) {
  const fallback = ROLL_KIND_LABELS[rollKind] ?? "Complex";
  if (!HEAL_ROLL_KIND_SET.has(rollKind)) return fallback;

  const key = `ARKHAM_HORROR.HEALING.RollKind.${rollKind}`;
  return game?.i18n?.has?.(key) ? game.i18n.localize(key) : fallback;
}

export class DiceRollApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;
    this.skillKey = options.skillKey;
    this.skillCurrent = options.skillCurrent;
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
        currentDicePool: this.currentDicePool,
        weaponToUse: this.weaponToUse,
        spellToUse: this.spellToUse,
        rollKind: this.rollKind,

        diceToUse: 0,
        horrorDiceToUse: 0,
        penalty: 0,
        bonusDice: 0,
        resultModifier: 0,
        successesNeeded: 0,

        rollWithAdvantage: false,
        rollWithDisadvantage: false,
        modifierAdvantage: 0, // 0 = none, 1 = advantage, 2 = disadvantage, 3 = both, needed for the dialog and reactive updates

        // Item roll effects (prompt-selectable): knacks, useful items, relics.
        selectedKnackIds: [],
        appliedKnacks: [],
        knackRerollAllowanceDice: 0,
        addSuccesses: 0,

        // Carried to the chat flags for the apply dialogs, never applied to the dice.
        effectHealDamage: 0,
        effectHealInjury: false,
        effectReduceHorrorLimit: 0,
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
      clickedIncreaseHorrorDice: this.#handleIncreaseHorrorDice,
      clickedDecreaseHorrorDice: this.#handleDecreaseHorrorDice,
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
    this.rollState.currentDicePool = this.currentDicePool;
    this.rollState.weaponToUse = this.weaponToUse;
    this.rollState.spellToUse = this.spellToUse;
    this.rollState.rollKind = this.rollKind ?? "complex";

    // Reset transient roll modifiers like your original code
    this.rollState.rollWithAdvantage = false;
    this.rollState.rollWithDisadvantage = false;
    this.rollState.modifierAdvantage = 0;
    this.rollState.diceToUse = 0;
    this.rollState.horrorDiceToUse = 0;
    this.rollState.bonusDice = 0;
    this.rollState.penalty = 0;
    this.rollState.resultModifier = 0;
    this.rollState.successesNeeded = 0;

    // Reset item effect selection
    this.rollState.selectedKnackIds = [];
    this.rollState.appliedKnacks = [];
    this.rollState.knackRerollAllowanceDice = 0;
    this.rollState.addSuccesses = 0;
    this.rollState.effectHealDamage = 0;
    this.rollState.effectHealInjury = false;
    this.rollState.effectReduceHorrorLimit = 0;

    if(options.spellToUse !== undefined && options.spellToUse !== null){ 
      options.successesNeeded = options.spellToUse.system.difficulty;
    }

    if (options.successesNeeded !== undefined) {
      this.rollState.successesNeeded = Number.parseInt(options.successesNeeded) || 0;
    }

    // Set localized window title at runtime (game.i18n is not available during static initialization).
    this.options.window.title = game?.i18n?.localize
      ? game.i18n.localize("ARKHAM_HORROR.Apps.DiceRoll.Title")
      : "Dice Roll";

    // Reactions: exactly 1 die from pool (bonus dice and adv/disadv can add rolled dice without costing pool)
    if (this.rollState.rollKind === "reaction") {
      const pool = Number.parseInt(this.rollState.currentDicePool) || 0;
      this.rollState.diceToUse = pool > 0 ? 1 : 0;
      const bounds = getHorrorSpendBounds(this.actor, {
        currentDicePool: pool,
        diceToUse: this.rollState.diceToUse,
        horrorDiceToUse: 0,
      });
      this.rollState.horrorDiceToUse = this.rollState.diceToUse > 0 ? Math.min(bounds.availableHorror, 1) : 0;
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
    const isHealRoll = HEAL_ROLL_KIND_SET.has(rollKind);
    // Healing rolls are complex actions (core p. 33/38), so the pool — horror dice included — is
    // spent exactly like on any other complex action.
    const showHorrorSelector = rollKind === "complex" || rollKind === "reaction" || isHealRoll;
    const bounds = getHorrorSpendBounds(this.actor, {
      currentDicePool: this.rollState.currentDicePool,
      diceToUse: this.rollState.diceToUse,
      horrorDiceToUse: this.rollState.horrorDiceToUse,
    });
    const availableHorror = bounds.availableHorror;
    const minHorrorDiceToUse = bounds.minHorrorDiceToUse;
    const maxHorrorDiceToUse = bounds.maxHorrorDiceToUse;
    this.rollState.horrorDiceToUse = bounds.clampedHorrorDiceToUse;

    const rollKindLabel = getRollKindLabel(rollKind);

    const isTomeUnderstand = rollKind === "tome-understand";
    const isSkillSelectable = isTomeUnderstand && Array.isArray(this.skillChoices) && this.skillChoices.length > 0;
    const skillChoices = isSkillSelectable
      ? this.skillChoices.map(key => ({
          key,
          label: game.i18n.localize(`ARKHAM_HORROR.SKILL.${key}`)
        }))
      : [];

    const injuryImpact = getInjuryImpactForSkillRoll({ actor: this.actor, rollState: this.rollState });
    const manualPenalty = Number(this.rollState.penalty ?? 0) || 0;
    const totalPenalty = manualPenalty + (Number(injuryImpact?.penalty ?? 0) || 0);

    // Feed template from rollState (no separate context mapping logic)
    // We show *matching* knacks (even if out of uses) to reduce confusion,
    // but we only allow selecting those that are currently usable.
    const matchingKnacks = getMatchingEffectItemsForRoll({ actor: this.actor, rollState: this.rollState });
    const applicableKnacks = getApplicableEffectItemsForRoll({ actor: this.actor, rollState: this.rollState });
    const applicableIdSet = new Set(applicableKnacks.map(k => String(k.id)));
    const selectedSet = new Set((this.rollState.selectedKnackIds ?? []).map(String));

    const formatSigned = (n) => {
      const num = Number(n ?? 0) || 0;
      return num >= 0 ? `+${num}` : `${num}`;
    };

    const formatSignedDice = (n, faces = 6) => {
      const num = Number(n ?? 0) || 0;
      return `${formatSigned(num)}d${faces}`;
    };

    const summarizeKnackModifier = (k) => {
      const mod = k?.system?.rollEffects?.modifier ?? {};
      const bonusDice = Number(mod.addBonusDice ?? 0) || 0;
      const resultMod = Number(mod.resultModifier ?? 0) || 0;
      const rerollAllow = Number(mod.rerollAllowanceDice ?? 0) || 0;
      const adv = Boolean(mod.advantage);
      const disadv = Boolean(mod.disadvantage);
      const addSuccesses = Number(mod.addSuccesses ?? 0) || 0;
      const healDamage = Number(mod.healDamage ?? 0) || 0;
      const healInjury = Boolean(mod.healInjury);
      const reduceHorrorLimit = Number(mod.reduceHorrorLimit ?? 0) || 0;

      const parts = [];
      if (bonusDice) parts.push(`${formatSignedDice(bonusDice, 6)}`);
      if (resultMod) parts.push(game.i18n.format("ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectResult", { mod: formatSigned(resultMod) }));
      if (adv && !disadv) parts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectAdv"));
      if (disadv && !adv) parts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectDisadv"));
      if (adv && disadv) parts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectAdvPlusDisadv"));
      if (rerollAllow) {
        const abs = Math.abs(rerollAllow);
        const key = abs === 1
          ? "ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectRerollDieOne"
          : "ARKHAM_HORROR.Dialog.DiceRoll.KnackEffectRerollDieMany";
        parts.push(game.i18n.format(key, { count: formatSigned(rerollAllow) }));
      }
      if (addSuccesses) parts.push(tRollEffect("AddSuccesses", { count: formatSigned(addSuccesses) }));
      if (healDamage) parts.push(tRollEffect("HealDamage", { count: healDamage }));
      if (healInjury) parts.push(tRollEffect("HealInjury"));
      if (reduceHorrorLimit) parts.push(tRollEffect("ReduceHorrorLimit", { count: reduceHorrorLimit }));

      return {
        bonusDice,
        resultMod,
        rerollAllow,
        adv,
        disadv,
        addSuccesses,
        healDamage,
        healInjury,
        reduceHorrorLimit,
        text: parts.length ? parts.join(", ") : game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.NoRollChanges"),
      };
    };

    const canRefreshKnacks = !!(this.actor?.isOwner || game.user?.isGM);

    const knackChoices = matchingKnacks.map(k => {
      const usage = k.system?.usage ?? {};
      const freq = String(usage.frequency ?? "passive");
      const max = Number(usage.max ?? 0);
      const remaining = Number(usage.remaining ?? 0);

      // A charge-based item (`decreaseAfterUsage`, e.g. a First Aid Kit) is limited by its charges
      // even when its frequency says "unlimited".
      const isLimited = !(freq === "passive" || freq === "unlimited");
      const isChargeBased = Boolean(usage.decreaseAfterUsage) && max > 0;
      const isCounted = isLimited || isChargeBased;
      const frequencyLabel = game.i18n?.localize
        ? game.i18n.localize(`ARKHAM_HORROR.KNACK_USAGE.${freq}`)
        : freq;
      const useText = isCounted ? `${frequencyLabel}: ${remaining}/${max}` : frequencyLabel;
      const usable = applicableIdSet.has(String(k.id));
      const exhausted = isCounted && remaining <= 0;
      const disabled = !usable;
      const checked = selectedSet.has(String(k.id)) && usable;

      const showRefresh = canRefreshKnacks && exhausted && max > 0;

      const effect = summarizeKnackModifier(k);

      const availabilityNote = exhausted
        ? game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.OutOfUses")
        : null;

      return {
        id: k.id,
        name: k.name,
        itemType: String(k.type ?? ""),
        tier: Number(k.system?.tier ?? 0),
        frequency: freq,
        frequencyLabel,
        useText,
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

    const knackSummary = {
      available: knackChoices.length,
      selected: knackChoices.filter(k => k.checked).length,
    };

    // Live preview: what the currently selected knacks would change.
    const selectedKnacksForPreview = resolveSelectedEffectItems({ actor: this.actor, selectedIds: this.rollState.selectedKnackIds });
    const preview = buildAppliedItemEffects({ selectedItems: selectedKnacksForPreview });
    const previewParts = [];
    if (preview.bonusDiceDelta) {
      previewParts.push(game.i18n.format("ARKHAM_HORROR.Dialog.DiceRoll.PreviewBonusDice", { dice: formatSignedDice(preview.bonusDiceDelta, 6) }));
    }
    if (preview.resultModifierDelta) {
      previewParts.push(game.i18n.format("ARKHAM_HORROR.Dialog.DiceRoll.PreviewResultModifier", { mod: formatSigned(preview.resultModifierDelta) }));
    }
    if (preview.advantage && !preview.disadvantage) previewParts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.PreviewAdvantage"));
    if (preview.disadvantage && !preview.advantage) previewParts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.PreviewDisadvantage"));
    if (preview.advantage && preview.disadvantage) previewParts.push(game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.PreviewAdvantagePlusDisadvantage"));
    if (preview.rerollAllowanceDice) {
      const n = Number(preview.rerollAllowanceDice ?? 0) || 0;
      const key = Math.abs(n) === 1
        ? "ARKHAM_HORROR.Dialog.DiceRoll.PreviewRerollAllowanceOne"
        : "ARKHAM_HORROR.Dialog.DiceRoll.PreviewRerollAllowanceMany";
      previewParts.push(game.i18n.format(key, { count: formatSigned(n) }));
    }
    if (preview.addSuccesses) previewParts.push(tRollEffect("AddSuccesses", { count: formatSigned(preview.addSuccesses) }));
    if (preview.healDamage) previewParts.push(tRollEffect("HealDamage", { count: preview.healDamage }));
    if (preview.healInjury) previewParts.push(tRollEffect("HealInjury"));
    if (preview.reduceHorrorLimit) previewParts.push(tRollEffect("ReduceHorrorLimit", { count: preview.reduceHorrorLimit }));

    const knackPreview = {
      hasSelection: (this.rollState.selectedKnackIds?.length ?? 0) > 0,
      text: previewParts.length ? previewParts.join(", ") : game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.NoRollChanges"),
      entries: previewParts.length ? previewParts : [game.i18n.localize("ARKHAM_HORROR.Dialog.DiceRoll.NoRollChanges")],
      bonusDiceDelta: preview.bonusDiceDelta,
      resultModifierDelta: preview.resultModifierDelta,
      advantage: preview.advantage,
      disadvantage: preview.disadvantage,
      rerollAllowanceDice: preview.rerollAllowanceDice,
      addSuccesses: preview.addSuccesses,
      healDamage: preview.healDamage,
      healInjury: preview.healInjury,
      reduceHorrorLimit: preview.reduceHorrorLimit,
    };

    return {
        ...context,

        actor: this.actor,
        rollKind,
        rollKindLabel,
        isReaction,
        isHealRoll,
        skillKey: this.rollState.skillKey,
        skillCurrent: this.rollState.skillCurrent,
        currentDicePool: this.rollState.currentDicePool,
        diceToUse: this.rollState.diceToUse,
        horrorDiceToUse: this.rollState.horrorDiceToUse,
        availableHorror,
        minHorrorDiceToUse,
        maxHorrorDiceToUse,
        showHorrorSelector,
        penalty: this.rollState.penalty,
        totalPenalty,
        injuryImpact,
        bonus_dice: this.rollState.bonusDice, // bonus_dice match form field name so this populates 0 correctly now
        resultModifier: this.rollState.resultModifier,
        successesNeeded: this.rollState.successesNeeded,
        rollWithAdvantage: this.rollState.rollWithAdvantage,
        rollWithDisadvantage: this.rollState.rollWithDisadvantage,
        modifierAdvantage: this.rollState.modifierAdvantage,
        weaponToUse: this.rollState.weaponToUse,
        spellToUse: this.rollState.spellToUse,

        knackChoices,
        knackSummary,
        knackPreview,

        isSkillSelectable,
        skillChoices
    };
  }

  async refreshKnackUses(_event, target) {
    const itemId = target?.dataset?.itemId;
    if (!itemId) return;

    if (!(this.actor?.isOwner || game.user?.isGM)) {
      ui.notifications?.warn?.(game.i18n.localize("ARKHAM_HORROR.Warnings.RefreshKnackUsesPermission"));
      return;
    }

    const knack = this.actor?.items?.get(itemId);
    if (!knack || !EFFECT_ITEM_TYPE_SET.has(knack.type)) return;

    const max = Number(knack.system?.usage?.max ?? 0);
    if (max <= 0) return;

    const freq = String(knack.system?.usage?.frequency ?? "passive");
    const isLimited = !(freq === "passive" || freq === "unlimited");
    if (!isLimited && !knack.system?.usage?.decreaseAfterUsage) return;

    await knack.update({ "system.usage.remaining": Math.max(0, max) });

    // Clearing selection avoids confusion if the user was expecting it to auto-apply.
    // (They can now check it, and the preview will update.)
    this.rollState.selectedKnackIds = [];

    // Preserve whether the Knacks dropdown was open before rerender.
    try {
      const details = this.element?.querySelector?.('[data-role="knacksDetails"]');
      this._knacksDetailsWasOpen = !!details?.open;
    } catch (e) {
      // ignore
    }

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

    // Restore UI state from the previous render cycle.
    const knacksDetails = form.querySelector?.('[data-role="knacksDetails"]');
    if (knacksDetails && typeof this._knacksDetailsWasOpen === "boolean") {
      knacksDetails.open = this._knacksDetailsWasOpen;
    }

    // Keep the stored state in sync when the user manually opens/closes the dropdown.
    if (knacksDetails) {
      knacksDetails.addEventListener(
        "toggle",
        () => {
          this._knacksDetailsWasOpen = !!knacksDetails.open;
        },
        { signal }
      );
    }

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

    // Validate the selection against applicability (prevents stale selection bugs when the user changes skill).
    if (!isApplicableEffectItemSelection({ actor: this.actor, rollState: this.rollState, itemIds: this.rollState.selectedKnackIds })) {
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.RollKnacksNotApplicable'));
      return;
    }

    // Apply the selected items' effects to rollState as deltas.
    const selectedKnacks = resolveSelectedEffectItems({ actor: this.actor, selectedIds: this.rollState.selectedKnackIds });
    const applied = buildAppliedItemEffects({ selectedItems: selectedKnacks });

    // Store applied items for chat flags.
    this.rollState.appliedKnacks = applied.appliedKnacks;
    this.rollState.knackRerollAllowanceDice = applied.rerollAllowanceDice;

    // Apply deltas to numeric modifiers.
    this.rollState.bonusDice = Number(this.rollState.bonusDice ?? 0) + applied.bonusDiceDelta;
    this.rollState.resultModifier = Number(this.rollState.resultModifier ?? 0) + applied.resultModifierDelta;
    // Assigned, not accumulated: there is no manual input for it that a rerun could fall back on.
    this.rollState.addSuccesses = applied.addSuccesses;

    // Not roll modifiers: these travel to the chat card so the apply dialogs can pick them up.
    this.rollState.effectHealDamage = applied.healDamage;
    this.rollState.effectHealInjury = applied.healInjury;
    this.rollState.effectReduceHorrorLimit = applied.reduceHorrorLimit;

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
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.RollReactionRequiresOneDie'));
        return; // keep dialog open
    }

    const horrorDiceToUse = Number(this.rollState.horrorDiceToUse ?? 0) || 0;
    if (horrorDiceToUse < 0 || horrorDiceToUse > this.rollState.diceToUse) {
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.SimpleActionInvalidHorrorSplit'));
      return;
    }

    // If Adv/Disadv selected, you must be rolling at least 1 die
    const baseDice = (this.rollState.diceToUse || 0) + (this.rollState.bonusDice || 0);
    if (this.rollState.modifierAdvantage !== 0 && baseDice <= 0) {
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.RollAdvDisadvRequiresDie'));
        return; // keep dialog open
    } else if (baseDice <= 0) {
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.RollMustRollAtLeastOneDie'));
        return; // keep dialog open
    }

    // Apply automatic injury penalties (do NOT overwrite the user-entered penalty field).
    const injuryImpact = getInjuryImpactForSkillRoll({ actor: this.actor, rollState: this.rollState });
    const manualPenalty = Number(this.rollState.penalty ?? 0) || 0;
    const injuryPenalty = Number(injuryImpact?.penalty ?? 0) || 0;
    const stateForRoll = {
      ...this.rollState,
      penalty: manualPenalty + injuryPenalty,
      injuryPenalty,
      appliedInjuries: Array.isArray(injuryImpact?.entries) ? injuryImpact.entries : [],
    };
    
    // Run workflow end-to-end (roll + update actor + post chat)
    const workflow = new SkillRollWorkflow();
    const result = await workflow.run({ actor: this.actor, state: stateForRoll });

    if (result?.ok === false) {
      return;
    }

    // Spend Knack uses only after the roll is executed.
    try {
      await spendItemUses({ actor: this.actor, selectedItems: selectedKnacks });
    } catch (_error) {
      ui.notifications?.warn?.(game.i18n.localize('ARKHAM_HORROR.Warnings.RollPostProcessingFailed'));
    }

    if (typeof this.afterRoll === "function") {
      try {
        await this.afterRoll({
          actor: this.actor,
          state: stateForRoll,
          ...result
        });
      } catch (e) {
        ui.notifications?.warn?.(game.i18n.localize('ARKHAM_HORROR.Warnings.RollPostProcessingFailed'));
      }
    }

    this.close();
  }

  updateRollStateWithForm(form){
    // Preserve whether the Knacks dropdown is expanded so rerenders don't surprise the user.
    try {
      const details = form?.querySelector?.('[data-role="knacksDetails"]');
      if (details) this._knacksDetailsWasOpen = !!details.open;
    } catch (e) {
      // ignore
    }

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
    this.rollState.horrorDiceToUse = Number.parseInt(form.horrorDiceToUse?.value) || 0;
    this.rollState.penalty = Number.parseInt(form.penalty.value) || 0;
    this.rollState.bonusDice = Number.parseInt(form.bonus_dice.value) || 0;
    this.rollState.resultModifier = Number.parseInt(form.resultModifier?.value) || 0;
    this.rollState.successesNeeded = Number.parseInt(form.difficulty.value) || 0;

    // Clamp reaction dice usage: exactly 1 die from pool if possible.
    if (this.rollState.rollKind === "reaction") {
        const pool = Number.parseInt(this.rollState.currentDicePool) || 0;
        this.rollState.diceToUse = pool > 0 ? 1 : 0;
    }

    const bounds = getHorrorSpendBounds(this.actor, {
      currentDicePool: this.rollState.currentDicePool,
      diceToUse: this.rollState.diceToUse,
      horrorDiceToUse: this.rollState.horrorDiceToUse,
    });
    this.rollState.horrorDiceToUse = bounds.clampedHorrorDiceToUse;

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

  static async #handleIncreaseHorrorDice(event, _target) {
    event.preventDefault();
    this.updateRollStateWithForm(event.target.form);

    const bounds = getHorrorSpendBounds(this.actor, {
      currentDicePool: this.rollState.currentDicePool,
      diceToUse: this.rollState.diceToUse,
      horrorDiceToUse: this.rollState.horrorDiceToUse,
    });

    this.rollState.horrorDiceToUse += 1;
    if (this.rollState.horrorDiceToUse > bounds.maxHorrorDiceToUse) {
      this.rollState.horrorDiceToUse = bounds.maxHorrorDiceToUse;
    }

    this.render({ force: true });
  }

  static async #handleDecreaseHorrorDice(event, _target) {
    event.preventDefault();
    this.updateRollStateWithForm(event.target.form);

    const bounds = getHorrorSpendBounds(this.actor, {
      currentDicePool: this.rollState.currentDicePool,
      diceToUse: this.rollState.diceToUse,
      horrorDiceToUse: this.rollState.horrorDiceToUse,
    });

    this.rollState.horrorDiceToUse -= 1;
    if (this.rollState.horrorDiceToUse < bounds.minHorrorDiceToUse) {
      this.rollState.horrorDiceToUse = bounds.minHorrorDiceToUse;
    }

    this.render({ force: true });
  }
}