import { formatCurrency, getMoney, parseMoneyInput, postMoneyChangeChat, setMoney } from "../helpers/money.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class MoneyAdjustApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instancesByActorUuid = new Map();

  static #getAppIdForActor(actor) {
    const suffix = actor?.id ?? actor?._id ?? actor?.uuid ?? foundry.utils.randomID();
    return `money-adjust-app-${String(suffix).replaceAll('.', '-')}`;
  }

  constructor(options = {}) {
    options.id ??= MoneyAdjustApp.#getAppIdForActor(options.actor);
    super(options);

    this.actor = options.actor;
    this.mode = options.mode ?? "add"; // add | spend | set

    this.moneyState = {
      amountRaw: "0.00",
    };
  }

  static DEFAULT_OPTIONS = {
    classes: ["dialog", "money-adjust-app", "dice-roll-app"],
    tag: "div",
    window: {
      frame: true,
      title: "Money",
      icon: "fa-solid fa-dollar-sign",
      positioned: true,
      resizable: false,
    },
    position: {
      width: 320,
      height: "auto",
    },
    actions: {
      clickedConfirm: this.#handleClickedConfirm,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/arkham-horror-rpg-fvtt/templates/money-adjust-app/dialog.hbs",
      scrollable: [""],
    },
  };

  setOptions(options = {}) {
    if (options.actor) this.actor = options.actor;
    this.mode = options.mode ?? this.mode ?? "add";

    const mode = this.mode === "spend" ? "spend" : this.mode === "set" ? "set" : "add";
    const titleKey = mode === "spend" ? "ARKHAM_HORROR.MONEY.WindowTitle.Spend" : mode === "set" ? "ARKHAM_HORROR.MONEY.WindowTitle.Set" : "ARKHAM_HORROR.MONEY.WindowTitle.Add";
    this.options.window.title = game.i18n.localize(titleKey);

    // reset each open
    this.moneyState.amountRaw = "0.00";
  }

  static getInstance(options = {}) {
    const actor = options.actor;
    const actorUuid = actor?.uuid;
    if (!actorUuid) {
      throw new Error("MoneyAdjustApp.getInstance requires an actor with a uuid");
    }

    if (!MoneyAdjustApp.instancesByActorUuid.has(actorUuid)) {
      MoneyAdjustApp.instancesByActorUuid.set(actorUuid, new MoneyAdjustApp(options));
    }

    const instance = MoneyAdjustApp.instancesByActorUuid.get(actorUuid);
    instance.setOptions(options);
    return instance;
  }

  async close(options = {}) {
    const result = await super.close(options);
    const actorUuid = this.actor?.uuid;
    if (actorUuid && MoneyAdjustApp.instancesByActorUuid.get(actorUuid) === this) {
      MoneyAdjustApp.instancesByActorUuid.delete(actorUuid);
    }
    return result;
  }

  _updateMoneyStateWithForm(form) {
    const raw = String(form?.amount?.value ?? "").trim();
    this.moneyState.amountRaw = raw;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const current = getMoney(this.actor);
    const currentBalance = formatCurrency(current);

    const mode = this.mode === "spend" ? "spend" : this.mode === "set" ? "set" : "add";
    const confirmKey = mode === "spend" ? "ARKHAM_HORROR.MONEY.Actions.Spend" : mode === "set" ? "ARKHAM_HORROR.MONEY.Actions.Set" : "ARKHAM_HORROR.MONEY.Actions.Add";
    const confirmLabel = game.i18n.localize(confirmKey);

    const parsed = parseMoneyInput(this.moneyState.amountRaw);
    const amountDisplay = parsed.ok ? formatCurrency(parsed.value) : "—";
    const amountHint = game.i18n.format("ARKHAM_HORROR.MONEY.Hints.Amount", { amount: amountDisplay });

    return {
      ...context,
      actor: this.actor,
      mode,
      confirmLabel,
      currentBalance,
      amount: this.moneyState.amountRaw,
      amountDisplay,
      amountHint,
    };
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element?.querySelector?.("form");
    if (!form) return;

    // Prevent default HTML form submission (Enter key) from navigating Foundry's URL.
    // This app uses explicit action handlers instead.
    form.onsubmit = (event) => {
      event.preventDefault();
      return false;
    };

    const amountInput = form.querySelector("input[name='amount']");
    const hint = form.querySelector(".money-amount-hint");
    if (!amountInput) return;

    const clampAndPreview = () => {
      const parsed = parseMoneyInput(amountInput.value);
      if (hint) {
        hint.textContent = game.i18n.format("ARKHAM_HORROR.MONEY.Hints.Amount", { amount: parsed.ok ? formatCurrency(parsed.value) : "—" });
      }
    };

    // Avoid stacking listeners across re-renders.
    amountInput.oninput = clampAndPreview;
    amountInput.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const confirmButton = form.querySelector("[data-action='clickedConfirm']");
      confirmButton?.click();
    };

    clampAndPreview();
  }

  static async #handleClickedConfirm(event, target) {
    return await this.clickedConfirmCallback(event, target);
  }

  async clickedConfirmCallback(event, target) {
    event.preventDefault();

    if (!(this.actor?.isOwner || game.user?.isGM)) {
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.MONEY.Errors.Permission"));
      return;
    }

    const form = target.form;
    this._updateMoneyStateWithForm(form);

    const parsed = parseMoneyInput(this.moneyState.amountRaw);
    if (!parsed.ok) {
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.MONEY.Errors.InvalidAmount"));
      return;
    }
    const amount = parsed.value;
    const oldAmount = getMoney(this.actor);

    if (this.mode !== "set" && amount <= 0) {
      ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.MONEY.Errors.AmountMustBePositive"));
      return;
    }

    let action = "add";
    let newAmount = oldAmount;
    let deltaAmount = 0;

    if (this.mode === "set") {
      action = "set";
      newAmount = Math.max(0, amount);
      deltaAmount = Math.abs(newAmount - oldAmount);
    } else if (this.mode === "spend") {
      action = "spend";
      // clamp at 0
      deltaAmount = Math.min(amount, oldAmount);
      newAmount = Math.max(0, oldAmount - amount);
    } else {
      action = "add";
      deltaAmount = amount;
      newAmount = oldAmount + amount;
    }

    await setMoney(this.actor, newAmount);
    await postMoneyChangeChat({ actor: this.actor, action, deltaAmount, oldAmount, newAmount });

    this.close();
  }

}
