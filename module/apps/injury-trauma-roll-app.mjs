import { InjuryTraumaWorkflow } from "../rolls/injury-trauma-workflow.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class InjuryTraumaRollApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;

    this.rollState = {
      rollKind: options.rollKind ?? "injury",
      modifier: Number.parseInt(options.modifier) || 0,
      dieFaces: Number.parseInt(options.dieFaces) || 6,
      rollMode: options.rollMode ?? "standard",
      fallingHeightFt: Number.parseInt(options.fallingHeightFt) || 10,
      rollSource: options.rollSource ?? "",
    };

    InjuryTraumaRollApp.instance = this;
  }

  static DEFAULT_OPTIONS = {
    id: "injury-trauma-roll-app",
    // Include dice-roll-app class so we inherit the same window-content background styles.
    classes: ["dialog", "injury-trauma-roll-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Injury / Trauma Roll",
      icon: "fa-solid fa-dice-d6",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 360,
      height: "auto",
    },
    actions: {
      clickedRoll: this.#handleClickedRoll,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/injury-trauma-roll-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;
    if (options.rollKind) this.rollState.rollKind = options.rollKind;
    if (options.modifier !== undefined) this.rollState.modifier = Number.parseInt(options.modifier) || 0;

    // IMPORTANT: This app is a singleton instance.
    // To avoid state leaking between uses, reset transient UI state every time
    // unless explicitly overridden by the caller.
    this.rollState.dieFaces = (options.dieFaces !== undefined)
      ? (Number.parseInt(options.dieFaces) || 6)
      : 6;
    this.rollState.rollMode = (options.rollMode !== undefined)
      ? String(options.rollMode ?? "standard")
      : "standard";
    this.rollState.fallingHeightFt = (options.fallingHeightFt !== undefined)
      ? (Number.parseInt(options.fallingHeightFt) || 10)
      : 10;
    this.rollState.rollSource = (options.rollSource !== undefined)
      ? String(options.rollSource ?? "")
      : "";

    // Set localized window title at runtime (game.i18n is not available during static initialization).
    this.options.window.title = game?.i18n?.localize
      ? game.i18n.localize("ARKHAM_HORROR.Apps.InjuryTraumaRoll.Title")
      : "Injury / Trauma Roll";
  }

  static getInstance(options = {}) {
    if (!InjuryTraumaRollApp.instance) {
      InjuryTraumaRollApp.instance = new InjuryTraumaRollApp(options);
    }
    const instance = InjuryTraumaRollApp.instance;
    instance.setOptions(options);
    return instance;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const rollMode = String(this.rollState.rollMode ?? "standard");
    const dieFaces = Number.parseInt(this.rollState.dieFaces) || 6;
    const modifier = Number.parseInt(this.rollState.modifier) || 0;
    const fallingHeightFt = Number.parseInt(this.rollState.fallingHeightFt) || 10;
    const rollKind = String(this.rollState.rollKind ?? "injury");

    const isFalling = rollMode === "falling" && rollKind === "injury";
    const numFallingDice = Math.max(1, Math.floor(fallingHeightFt / 10));

    const formulaHint = isFalling
      ? `Total = ${numFallingDice}d3 (no modifier)`
      : `Total = 1d${dieFaces} + modifier`;

    return {
      ...context,
      actor: this.actor,
      rollKind,
      modifier,
      dieFaces,
      rollMode: isFalling ? "falling" : "standard",
      fallingHeightFt,
      rollSource: this.rollState.rollSource,
      formulaHint,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element?.querySelector?.("form");
    if (!form) return;

    const updateVisibilityAndHint = () => {
      const rollKind = String(form.rollKind?.value ?? "injury");
      const rollMode = String(form.rollMode?.value ?? "standard");
      const dieFaces = Number.parseInt(form.dieFaces?.value) || 6;
      const modifierInput = form.modifier;
      const heightInput = form.fallingHeightFt;

      // Falling only applies to injury; clamp UI to standard if trauma is selected.
      const fallingAllowed = rollKind === "injury";
      const fallingOption = form.rollMode?.querySelector?.('option[value="falling"]');
      if (fallingOption) fallingOption.disabled = !fallingAllowed;
      if (!fallingAllowed && rollMode === "falling") {
        form.rollMode.value = "standard";
      }

      const effectiveMode = String(form.rollMode?.value ?? "standard");
      const isFalling = effectiveMode === "falling" && rollKind === "injury";

      // Show/hide mode-specific fields.
      form.querySelectorAll('[data-roll-mode="falling"]').forEach(el => {
        el.style.display = isFalling ? "" : "none";
      });
      form.querySelectorAll('[data-roll-mode="standard"]').forEach(el => {
        el.style.display = isFalling ? "none" : "";
      });

      // Falling ignores modifier.
      if (modifierInput) {
        modifierInput.disabled = isFalling;
        if (isFalling) modifierInput.value = 0;
      }

      // Update hint text.
      const hint = form.querySelector('[data-role="formulaHint"]');
      if (hint) {
        if (isFalling) {
          const height = Number.parseInt(heightInput?.value) || 0;
          const n = Math.max(1, Math.floor(height / 10));
          hint.textContent = `Total = ${n}d3 (no modifier)`;
        } else {
          hint.textContent = `Total = 1d${dieFaces} + modifier`;
        }
      }

      // Disable roll when falling height is invalid.
      const rollButton = form.querySelector('button[data-action="clickedRoll"]');
      if (rollButton) {
        if (isFalling) {
          const height = Number.parseInt(heightInput?.value) || 0;
          rollButton.disabled = height < 10;
        } else {
          rollButton.disabled = false;
        }
      }
    };

    // Initial paint.
    updateVisibilityAndHint();

    // React to changes.
    form.rollKind?.addEventListener?.("change", updateVisibilityAndHint);
    form.rollMode?.addEventListener?.("change", updateVisibilityAndHint);
    form.dieFaces?.addEventListener?.("change", updateVisibilityAndHint);
    form.fallingHeightFt?.addEventListener?.("input", updateVisibilityAndHint);
  }

  static async #handleClickedRoll(event, target) {
    this.clickedRollCallback(event, target);
  }

  async clickedRollCallback(event, target) {
    event.preventDefault();

    if (!this.actor?.isOwner) {
      ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.PermissionRollActor'));
      return;
    }

    const form = target.form;
    const rollKind = String(form.rollKind?.value ?? "injury");
    const rollMode = String(form.rollMode?.value ?? "standard");
    const dieFaces = Number.parseInt(form.dieFaces?.value) || 6;
    const modifier = Number.parseInt(form.modifier?.value) || 0;
    const fallingHeightFt = Number.parseInt(form.fallingHeightFt?.value) || 0;
    const rollSource = String(form.rollSource?.value ?? "");

    if (rollMode === "falling") {
      if (rollKind !== "injury") {
        ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.InjuryTraumaFallingModeInjuryOnly'));
        return;
      }
      if (fallingHeightFt < 10) {
        ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.Warnings.InjuryTraumaFallingHeightMin', { minFt: 10 }));
        return;
      }
    }

    const workflow = new InjuryTraumaWorkflow();
    await workflow.run({
      actor: this.actor,
      state: { rollKind, modifier, dieFaces, rollMode, fallingHeightFt, rollSource },
    });

    this.close();
  }
}
