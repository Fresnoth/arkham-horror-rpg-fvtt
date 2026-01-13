import { InjuryTraumaWorkflow } from "../rolls/injury-trauma-workflow.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class InjuryTraumaRollApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;

    this.rollState = {
      rollKind: options.rollKind ?? "injury",
      modifier: Number.parseInt(options.modifier) || 0,
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

    return {
      ...context,
      actor: this.actor,
      rollKind: this.rollState.rollKind,
      modifier: this.rollState.modifier,
    };
  }

  static async #handleClickedRoll(event, target) {
    this.clickedRollCallback(event, target);
  }

  async clickedRollCallback(event, target) {
    event.preventDefault();

    const form = target.form;
    const rollKind = String(form.rollKind?.value ?? "injury");
    const modifier = Number.parseInt(form.modifier?.value) || 0;

    const workflow = new InjuryTraumaWorkflow();
    await workflow.run({
      actor: this.actor,
      state: { rollKind, modifier },
    });

    this.close();
  }
}
