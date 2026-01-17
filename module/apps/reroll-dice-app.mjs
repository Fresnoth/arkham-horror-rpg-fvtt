const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class RerollDiceApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;
    this.message = options.message;
    this.rollFlags = options.rollFlags;
    this.onConfirm = options.onConfirm;

    RerollDiceApp.instance = this;
  }

  static DEFAULT_OPTIONS = {
    id: "reroll-dice-app",
    classes: ["dialog", "reroll-dice-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Reroll Dice",
      icon: "fa-solid fa-arrow-rotate-right",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 420,
      height: "auto",
    },
    actions: {
      clickedReroll: this.#handleClickedReroll,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/reroll-dice-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;
    if (options.message) this.message = options.message;
    if (options.rollFlags) this.rollFlags = options.rollFlags;
    if (typeof options.onConfirm === "function") this.onConfirm = options.onConfirm;
  }

  static getInstance(options = {}) {
    if (!RerollDiceApp.instance) {
      RerollDiceApp.instance = new RerollDiceApp(options);
    }
    const instance = RerollDiceApp.instance;
    instance.setOptions(options);
    return instance;
  }

  async close(options = {}) {
    const result = await super.close(options);
    if (RerollDiceApp.instance === this) {
      RerollDiceApp.instance = null;
    }
    return result;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const results = Array.isArray(this.rollFlags?.results) ? this.rollFlags.results : [];

    const dice = results.map((d, index) => {
      const isHorror = !!d?.isHorror;
      const rawResult = Number(d?.rawResult ?? 0);
      const result = Number(d?.result ?? rawResult);
      const isDropped = !!d?.isDropped;
      const isNat1 = !!d?.isNat1;
      const isNat6 = !!d?.isNat6;

      const isForbidden = isDropped || (isHorror && rawResult === 1);

      return {
        index,
        rawResult,
        result,
        isHorror,
        isDropped,
        isNat1,
        isNat6,
        isForbidden,
        isSelectable: !isForbidden,
      };
    });

    return {
      ...context,
      actor: this.actor,
      messageId: this.message?.id ?? "",
      penalty: Number(this.rollFlags?.penalty ?? 0),
      resultModifier: Number(this.rollFlags?.resultModifier ?? 0),
      successOn: Number(this.rollFlags?.successOn ?? 0),
      dice,
    };
  }

  static async #handleClickedReroll(event, target) {
    this.clickedRerollCallback(event, target);
  }

  async clickedRerollCallback(event, target) {
    event.preventDefault();

    const form = target.form;
    const selected = Array.from(form.querySelectorAll('input[name="rerollDie"]:checked'))
      .map(el => Number(el.value))
      .filter(Number.isFinite);

    if (selected.length === 0) {
      ui.notifications.warn("Select at least one die to reroll.");
      return;
    }

    if (typeof this.onConfirm === "function") {
      await this.onConfirm({ selectedIndices: selected, actor: this.actor, message: this.message });
    }

    this.close();
  }
}
