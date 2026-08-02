import {
  applyDamageAndPost,
  collectDamageHints,
  getDefaultHorror,
  previewDamage,
  previewHorror,
} from "../helpers/damage.mjs";
// Imported directly instead of through `api/rolls`: that route would create the import cycle
// api/resources -> helpers/damage -> api/rolls -> dice-roll-app -> skill-roll-workflow -> api/resources
// (the same reason is documented in `helpers/strain.mjs`).
import { InjuryTraumaRollApp } from "./injury-trauma-roll-app.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ApplyDamageApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instancesByActorUuid = new Map();

  static #getAppIdForActor(actor) {
    const suffix = actor?.id ?? actor?._id ?? actor?.uuid ?? foundry.utils.randomID();
    return `apply-damage-app-${String(suffix).replaceAll('.', '-')}`;
  }

  constructor(options = {}) {
    options.id ??= ApplyDamageApp.#getAppIdForActor(options.actor);
    super(options);

    this.actor = options.actor;
    this.damageState = {
      amount: 0,
      horror: 0,
      injury: false,
    };
    this.attack = {};
  }

  static DEFAULT_OPTIONS = {
    classes: ["dialog", "apply-damage-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Apply Damage",
      icon: "fa-solid fa-heart-crack",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 380,
      height: "auto",
    },
    actions: {
      clickedApply: this.#handleClickedApply,
      clickedCancel: this.#handleClickedCancel,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/apply-damage-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;

    this.attack = {
      attackerName: String(options.attackerName ?? ""),
      weaponName: String(options.weaponName ?? ""),
      targetName: String(options.targetName ?? this.actor?.name ?? ""),
      successes: Number.parseInt(options.successes) || 0,
      injuryRating: options.injuryRating === null || options.injuryRating === undefined
        ? null
        : Number.parseInt(options.injuryRating) || 0,
      source: String(options.source ?? "chat"),
    };

    // Reset transient state on every open; the dialog is a per-actor singleton.
    this.damageState.amount = Math.max(0, Number.parseInt(options.amount) || 0);
    this.damageState.injury = !!options.inflictInjury;

    // Horror is pre-filled from the attack when the caller does not name a number itself: a spell
    // whose rules text inflicts horror on its target is the common case (core p. 36).
    const hasExplicitHorror = options.horror !== undefined && options.horror !== null;
    this.damageState.horror = hasExplicitHorror
      ? Math.max(0, Number.parseInt(options.horror) || 0)
      : getDefaultHorror({ flags: options.rollFlags, spell: options.spell });
    this.attack.horrorPrefilled = !hasExplicitHorror && this.damageState.horror > 0;

    this.options.window.title = game?.i18n?.localize
      ? game.i18n.localize("ARKHAM_HORROR.DAMAGE.Dialog.Title")
      : "Apply Damage";
  }

  static getInstance(options = {}) {
    const actor = options.actor;
    const actorUuid = actor?.uuid;
    if (!actorUuid) {
      throw new Error("ApplyDamageApp.getInstance requires an actor with a uuid");
    }

    if (!ApplyDamageApp.instancesByActorUuid.has(actorUuid)) {
      ApplyDamageApp.instancesByActorUuid.set(actorUuid, new ApplyDamageApp(options));
    }

    const instance = ApplyDamageApp.instancesByActorUuid.get(actorUuid);
    instance.setOptions(options);
    return instance;
  }

  async close(options = {}) {
    const result = await super.close(options);
    const actorUuid = this.actor?.uuid;
    if (actorUuid && ApplyDamageApp.instancesByActorUuid.get(actorUuid) === this) {
      ApplyDamageApp.instancesByActorUuid.delete(actorUuid);
    }
    return result;
  }

  _updateDamageStateWithForm(form) {
    const amount = Number.parseInt(form?.amount?.value);
    const horror = Number.parseInt(form?.horror?.value);
    this.damageState.amount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    this.damageState.horror = Number.isFinite(horror) ? Math.max(0, horror) : 0;
    this.damageState.injury = !!form?.injury?.checked;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const preview = previewDamage(this.actor, this.damageState.amount);
    const horrorPreview = this.#horrorPreview(this.damageState.amount, this.damageState.horror);
    const hints = collectDamageHints(this.actor);
    const injuryRating = this.attack.injuryRating;

    return {
      ...context,
      actor: this.actor,
      attackerName: this.attack.attackerName,
      weaponName: this.attack.weaponName,
      targetName: this.attack.targetName || this.actor?.name || "",
      hasAttacker: !!this.attack.attackerName,
      hasWeapon: !!this.attack.weaponName,
      amount: this.damageState.amount,
      horror: this.damageState.horror,
      horrorPreviewText: this.#formatHorrorPreview(horrorPreview),
      horrorAtMax: horrorPreview.atMax,
      horrorAtMaxWarning: game.i18n.format("ARKHAM_HORROR.DAMAGE.Dialog.HorrorAtMax", {
        targetName: this.attack.targetName || this.actor?.name || "",
        max: horrorPreview.max,
      }),
      horrorPrefilled: !!this.attack.horrorPrefilled,
      injury: this.damageState.injury,
      injuryRating,
      // The rating is only meaningful when the attack came from a weapon that can injure at all.
      showInjuryHint: Number.isFinite(injuryRating) && injuryRating > 0,
      successes: this.attack.successes,
      previewText: this.#formatPreview(preview),
      wouldBeWounded: preview.wouldBeWounded,
      woundedWarning: game.i18n.format("ARKHAM_HORROR.DAMAGE.Dialog.WoundedWarning", {
        targetName: this.attack.targetName || this.actor?.name || "",
      }),
      hints,
      hasHints: hints.length > 0,
    };
  }

  #formatPreview(preview) {
    return game.i18n.format("ARKHAM_HORROR.DAMAGE.Dialog.Preview", {
      oldLimit: preview.oldLimit,
      newLimit: preview.newLimit,
    });
  }

  // Damage lands first, so the horror dice are drawn against the pool it leaves behind — the
  // apply step does the same.
  #horrorPreview(amount, horror) {
    const damagePreview = previewDamage(this.actor, amount);
    const poolValue = Math.max(0, Number.parseInt(this.actor?.system?.dicepool?.value) || 0);
    return previewHorror(this.actor, horror, {
      dicePoolValue: Math.min(poolValue, damagePreview.newLimit),
    });
  }

  #formatHorrorPreview(preview) {
    return game.i18n.format("ARKHAM_HORROR.DAMAGE.Dialog.HorrorPreview", {
      oldHorror: preview.oldHorror,
      newHorror: preview.newHorror,
      oldHorrorInPool: preview.oldHorrorInPool,
      newHorrorInPool: preview.newHorrorInPool,
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
    const horrorInput = form.querySelector("input[name='horror']");
    const previewEl = form.querySelector("[data-role='damagePreview']");
    const warningEl = form.querySelector("[data-role='woundedWarning']");
    const horrorPreviewEl = form.querySelector("[data-role='horrorPreview']");
    const horrorWarningEl = form.querySelector("[data-role='horrorAtMax']");
    if (!amountInput) return;

    const readNumber = (input) => Math.max(0, Number.parseInt(input?.value) || 0);

    const refreshPreview = () => {
      const amount = readNumber(amountInput);
      const preview = previewDamage(this.actor, amount);
      if (previewEl) previewEl.textContent = this.#formatPreview(preview);
      if (warningEl) warningEl.hidden = !preview.wouldBeWounded;

      // Horror depends on the damage as well: it can only fill dice that are still in the pool.
      const horrorPreview = this.#horrorPreview(amount, readNumber(horrorInput));
      if (horrorPreviewEl) horrorPreviewEl.textContent = this.#formatHorrorPreview(horrorPreview);
      if (horrorWarningEl) horrorWarningEl.hidden = !horrorPreview.atMax;
    };

    const submitOnEnter = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      form.querySelector("[data-action='clickedApply']")?.click();
    };

    amountInput.oninput = refreshPreview;
    amountInput.onkeydown = submitOnEnter;
    if (horrorInput) {
      horrorInput.oninput = refreshPreview;
      horrorInput.onkeydown = submitOnEnter;
    }

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
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.DAMAGE.Reasons.PERMISSION_DENIED"));
      return;
    }

    this._updateDamageStateWithForm(target.form);
    const { amount, horror, injury } = this.damageState;

    const result = await applyDamageAndPost({
      actor: this.actor,
      amount,
      horror,
      source: this.attack.source,
      attackerName: this.attack.attackerName,
      weaponName: this.attack.weaponName,
    });
    if (!result?.ok) return;

    // Core p. 30: the injury is a separate consequence of the hit, rolled on the existing dialog.
    if (injury) {
      InjuryTraumaRollApp.getInstance({
        actor: this.actor,
        rollKind: "injury",
        rollSource: "damage",
      }).render(true);
    }

    this.close();
  }
}
