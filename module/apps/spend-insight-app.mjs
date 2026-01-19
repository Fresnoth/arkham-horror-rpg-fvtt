import { spendInsightAndPost } from "../helpers/insight.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class SpendInsightApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instancesByActorUuid = new Map();

  constructor(options = {}) {
    super(options);

    this.actor = options.actor;

    this.insightState = {
      amount: 1,
    };
  }

  static DEFAULT_OPTIONS = {
    id: "spend-insight-app",
    classes: ["dialog", "spend-insight-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Spend Insight",
      icon: "fa-solid fa-lightbulb",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 360,
      height: "auto",
    },
    actions: {
      clickedSpend: this.#handleClickedSpend,
      clickedIncreaseSpend: this.#handleIncreaseSpend,
      clickedDecreaseSpend: this.#handleDecreaseSpend,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/spend-insight-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;

    // Reset transient state each open
    this.insightState.amount = 1;
  }

  static getInstance(options = {}) {
    const actor = options.actor;
    const actorUuid = actor?.uuid;
    if (!actorUuid) {
      throw new Error("SpendInsightApp.getInstance requires an actor with a uuid");
    }

    if (!SpendInsightApp.instancesByActorUuid.has(actorUuid)) {
      SpendInsightApp.instancesByActorUuid.set(actorUuid, new SpendInsightApp(options));
    }

    const instance = SpendInsightApp.instancesByActorUuid.get(actorUuid);
    instance.setOptions(options);
    return instance;
  }

  async close(options = {}) {
    const result = await super.close(options);
    const actorUuid = this.actor?.uuid;
    if (actorUuid && SpendInsightApp.instancesByActorUuid.get(actorUuid) === this) {
      SpendInsightApp.instancesByActorUuid.delete(actorUuid);
    }
    return result;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const remaining = Number(this.actor?.system?.insight?.remaining) || 0;
    const limit = Number(this.actor?.system?.insight?.limit) || 0;

    return {
      ...context,
      actor: this.actor,
      amount: this.insightState.amount,
      remaining,
      limit,
      max: remaining,
    };
  }

  updateInsightStateWithForm(form) {
    const max = Number(this.actor?.system?.insight?.remaining) || 0;
    const raw = Number(form?.amount?.value ?? 1);
    const amount = Math.trunc(Number.isFinite(raw) ? raw : 1);

    // Clamp to [1, max] but allow 1 even if max is 0 (dialog shouldn't be reachable then)
    const clamped = Math.max(1, Math.min(amount, Math.max(1, max)));
    this.insightState.amount = clamped;
  }

  static async #handleClickedSpend(event, target) {
    return await this.clickedSpendCallback(event, target);
  }

  async clickedSpendCallback(event, target) {
    event.preventDefault();

    const form = target.form;
    this.updateInsightStateWithForm(form);
    const amount = this.insightState.amount;

    if (!Number.isFinite(amount) || amount <= 0) {
      ui.notifications.warn("Insight spend amount must be at least 1.");
      return;
    }

    const remaining = Number(this.actor?.system?.insight?.remaining) || 0;
    if (amount > remaining) {
      ui.notifications.warn(`${this.actor.name} does not have enough Insight remaining.`);
      return;
    }

    const result = await spendInsightAndPost({ actor: this.actor, amount, source: "sheet" });
    if (result?.ok) {
      this.close();
    }
  }

  static async #handleIncreaseSpend(event, target) {
    return await this.clickedIncreaseSpendCallback(event, target);
  }

  async clickedIncreaseSpendCallback(event, target) {
    event.preventDefault();
    this.updateInsightStateWithForm(target.form);

    const max = Number(this.actor?.system?.insight?.remaining) || 0;
    const upper = Math.max(1, max);
    this.insightState.amount = Math.min(upper, (this.insightState.amount || 1) + 1);

    this.render({ force: true });
  }

  static async #handleDecreaseSpend(event, target) {
    return await this.clickedDecreaseSpendCallback(event, target);
  }

  async clickedDecreaseSpendCallback(event, target) {
    event.preventDefault();
    this.updateInsightStateWithForm(target.form);

    this.insightState.amount = Math.max(1, (this.insightState.amount || 1) - 1);
    this.render({ force: true });
  }
}
