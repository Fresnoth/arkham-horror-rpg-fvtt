import {
  adjustHorrorLimit,
  applyHealingAndPost,
  collectHealingHints,
  getHealableInjuries,
  isHorrorRollKind,
  previewHeal,
  previewHorrorLimit,
  resolveHealEffects,
} from "../helpers/healing.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Applies the result of a healing roll to one target (core p. 33-34 and p. 38).
 *
 * Two modes in one dialog, because they share the whole surrounding chain (roll → card → apply):
 *   - "heal":   damage (1 per success, editable) and the target's injuries
 *   - "horror": Introspection / Counseling, which lower the horror limit by exactly 1
 *
 * Built after `ApplyDamageApp`: a per-target singleton, live preview, and a hint list that is
 * explicitly not calculated into anything.
 */
export class HealApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instancesByActorUuid = new Map();

  static #getAppIdForActor(actor) {
    const suffix = actor?.id ?? actor?._id ?? actor?.uuid ?? foundry.utils.randomID();
    return `heal-app-${String(suffix).replaceAll('.', '-')}`;
  }

  constructor(options = {}) {
    options.id ??= HealApp.#getAppIdForActor(options.actor);
    super(options);

    this.actor = options.actor;
    this.healer = null;
    this.healState = {
      amount: 0,
      injuryIds: [],
    };
    this.heal = {};
  }

  static DEFAULT_OPTIONS = {
    classes: ["dialog", "heal-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Apply Healing",
      icon: "fa-solid fa-kit-medical",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 400,
      height: "auto",
    },
    actions: {
      clickedApply: this.#handleClickedApply,
      clickedCancel: this.#handleClickedCancel,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/heal-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;
    if (Object.prototype.hasOwnProperty.call(options, "healer")) this.healer = options.healer ?? null;

    const rollKind = String(options.rollKind ?? "heal-damage");
    const successes = Math.max(0, Number.parseInt(options.successes) || 0);

    // What the items used on the roll contribute. Callers hand this in already resolved; without it
    // the dialog behaves exactly as it did before item effects existed.
    const effects = options.effects ?? resolveHealEffects({ rollKind, successes, flags: {} });

    this.heal = {
      rollKind,
      isHorror: isHorrorRollKind(rollKind),
      successes,
      effects,
      rollSucceeded: options.rollSucceeded === undefined ? successes > 0 : !!options.rollSucceeded,
      healerName: String(options.healerName ?? this.healer?.name ?? ""),
      targetName: String(options.targetName ?? this.actor?.name ?? ""),
      source: String(options.source ?? "chat"),
    };

    // Reset transient state on every open; the dialog is a per-target singleton.
    // Core p. 33: healing damage restores 1 point per success, plus whatever an item adds on top.
    // An injury roll spends its successes on the injury instead, so its base is 0.
    this.healState.amount = effects.amount;
    this.healState.injuryIds = [];

    this.options.window.title = game?.i18n?.localize
      ? game.i18n.localize(this.heal.isHorror
        ? "ARKHAM_HORROR.HEALING.Dialog.TitleHorror"
        : "ARKHAM_HORROR.HEALING.Dialog.Title")
      : "Apply Healing";
  }

  static getInstance(options = {}) {
    const actor = options.actor;
    const actorUuid = actor?.uuid;
    if (!actorUuid) {
      throw new Error("HealApp.getInstance requires an actor with a uuid");
    }

    if (!HealApp.instancesByActorUuid.has(actorUuid)) {
      HealApp.instancesByActorUuid.set(actorUuid, new HealApp(options));
    }

    const instance = HealApp.instancesByActorUuid.get(actorUuid);
    instance.setOptions(options);
    return instance;
  }

  async close(options = {}) {
    const result = await super.close(options);
    const actorUuid = this.actor?.uuid;
    if (actorUuid && HealApp.instancesByActorUuid.get(actorUuid) === this) {
      HealApp.instancesByActorUuid.delete(actorUuid);
    }
    return result;
  }

  _updateHealStateWithForm(form) {
    const amount = Number.parseInt(form?.amount?.value);
    this.healState.amount = Number.isFinite(amount) ? Math.max(0, amount) : 0;

    const selected = [];
    try {
      for (const box of form?.querySelectorAll?.('input[name="injuryIds"]:checked') ?? []) {
        const id = String(box.value ?? "");
        if (id) selected.push(id);
      }
    } catch (e) {
      // ignore
    }
    this.healState.injuryIds = selected;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const effects = this.heal.effects;

    // Self-treatment is legal (core p. 33), so the hints fall back to the target's own supplies.
    const hints = collectHealingHints(this.healer ?? this.actor);
    const injuries = getHealableInjuries(this.actor, {
      successes: this.heal.successes,
      difficultyReduction: effects.difficultyReduction,
    }).map(injury => ({ ...injury, checked: this.healState.injuryIds.includes(injury.id) }));

    const horrorPreview = previewHorrorLimit(this.actor, effects.horrorDelta);

    return {
      ...context,
      actor: this.actor,
      isHorror: this.heal.isHorror,
      rollKind: this.heal.rollKind,
      rollKindLabel: game.i18n.localize(`ARKHAM_HORROR.HEALING.RollKind.${this.heal.rollKind}`),
      rollSucceeded: this.heal.rollSucceeded,
      effectSources: effects.sources,
      hasEffectSources: effects.sources.length > 0,
      horrorSteps: Math.abs(effects.horrorDelta),
      healerName: this.heal.healerName,
      hasHealer: !!this.heal.healerName,
      targetName: this.heal.targetName || this.actor?.name || "",
      successes: this.heal.successes,
      amount: this.healState.amount,
      previewText: this.#formatPreview(previewHeal(this.actor, this.healState.amount)),
      horrorPreviewText: game.i18n.format("ARKHAM_HORROR.HEALING.Dialog.HorrorPreview", {
        oldHorror: horrorPreview.oldHorror,
        newHorror: horrorPreview.newHorror,
      }),
      canLowerHorror: horrorPreview.applied !== 0,
      injuries,
      hasInjuries: injuries.length > 0,
      hints,
      hasHints: hints.length > 0,
    };
  }

  #formatPreview(preview) {
    return game.i18n.format("ARKHAM_HORROR.HEALING.Dialog.Preview", {
      oldLimit: preview.oldLimit,
      newLimit: preview.newLimit,
    });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element?.querySelector?.("form");
    if (!form) return;

    // Enter must not submit the form — the app drives everything through action handlers.
    form.onsubmit = (event) => {
      event.preventDefault();
      return false;
    };

    const amountInput = form.querySelector("input[name='amount']");
    const previewEl = form.querySelector("[data-role='healPreview']");
    if (!amountInput) return;

    const refreshPreview = () => {
      const amount = Math.max(0, Number.parseInt(amountInput.value) || 0);
      if (previewEl) previewEl.textContent = this.#formatPreview(previewHeal(this.actor, amount));
    };

    amountInput.oninput = refreshPreview;
    amountInput.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      form.querySelector("[data-action='clickedApply']")?.click();
    };

    refreshPreview();
  }

  static async #handleClickedApply(event, target) {
    return await this.clickedApplyCallback(event, target);
  }

  static async #handleClickedCancel(event, target) {
    event.preventDefault();
    return await this.close();
  }

  async clickedApplyCallback(event, target) {
    event.preventDefault();

    if (!(this.actor?.isOwner || game.user?.isGM)) {
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.HEALING.Reasons.PERMISSION_DENIED"));
      return;
    }

    // Core p. 38: a success lowers the horror limit by exactly 1 — never by the number of successes.
    // An item may add further steps on top; `resolveHealEffects` has already folded that in.
    if (this.heal.isHorror) {
      const result = await adjustHorrorLimit(this.actor, this.heal.effects.horrorDelta, {
        source: this.heal.source,
        healerName: this.heal.healerName,
      });
      if (result?.ok) this.close();
      return;
    }

    this._updateHealStateWithForm(target.form);
    const { amount, injuryIds } = this.healState;

    const result = await applyHealingAndPost({
      actor: this.actor,
      amount,
      injuryIds,
      source: this.heal.source,
      healerName: this.heal.healerName,
    });
    if (!result?.ok) return;

    this.close();
  }
}
