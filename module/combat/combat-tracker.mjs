const FLAG_SCOPE = "arkham-horror-rpg-fvtt";
const FLAG_FIRST = "firstSide";
const FLAG_ACTIVE = "activeSide";

export class ArkhamHorrorCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  static PARTS = foundry.utils.mergeObject(super.PARTS, {
    tracker: {
      ...super.PARTS.tracker,
      template: `systems/arkham-horror-rpg-fvtt/templates/combat/combat-tracker.hbs`
    },
    footer: {
      template: `systems/arkham-horror-rpg-fvtt/templates/combat/combat-footer.hbs`
    }
  });

  // Add our click actions (HandlebarsApplication routes data-action to DEFAULT_OPTIONS.actions)
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    actions: {
      ...super.DEFAULT_OPTIONS.actions,
      beginSideCombat: async function () { await this._beginSideCombat(); },
      endSidePhase: async function () { await this._endSidePhase(); },
    }
  });

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);

    const combat = this.viewed;
    if (!combat) return context;

    if (partId === "footer") {
      const active = (await combat.getFlag(FLAG_SCOPE, FLAG_ACTIVE)) ?? null;
      context.side = {
        started: combat.started,
        active,
        activeLabel: active === "npcs" ? "NPCs" : "Investigators",
        nextLabel: active === "npcs" ? "Investigators" : "NPCs",
        canControl: combat.isOwner
      };
    }

    if (partId === "tracker") {
      const active = (await combat.getFlag(FLAG_SCOPE, FLAG_ACTIVE)) ?? null;
      context.side = { active };

      // In Foundry, `combat.turns` can be empty depending on turn/initiative prep.
      // Fall back to combatants list so the tracker always shows entries.
      const turns = (combat.turns?.length ? combat.turns : (combat.combatants?.contents ?? []));
      const groups = [
        { key: "investigators", label: "Investigators", isActive: active === "investigators", entries: [] },
        { key: "npcs", label: "NPCs", isActive: active === "npcs", entries: [] },
      ];

      for (const combatant of turns) {
        const actorType = combatant.actor?.type;
        const groupKey = actorType === "npc" ? "npcs" : "investigators";
        const group = groups.find(g => g.key === groupKey) ?? groups[0];

        // Side-based highlighting: every combatant on the active side is marked "active".
        const isActiveSide = !!combat.started && active === groupKey;

        const dicepool = combatant.actor?.system?.dicepool;
        const dicepoolValue = dicepool?.value;
        const dicepoolMax = dicepool?.max;
        const damage = combatant.actor?.system?.damage ?? 0;

        // Dicepool "max" is reduced by current damage (see base actor derived data).
        // If max is missing, fall back to showing whatever exists.
        const numericDicepoolMax = Number(dicepoolMax);
        const numericDamage = Number(damage) || 0;
        const presentDicepoolMax = Number.isFinite(numericDicepoolMax)
          ? Math.max(0, numericDicepoolMax - numericDamage)
          : dicepoolMax;

        const presentDicepoolValue = (Number.isFinite(presentDicepoolMax) && dicepoolValue != null)
          ? Math.min(dicepoolValue, presentDicepoolMax)
          : dicepoolValue;

        const dicepoolDisplay = (presentDicepoolValue ?? presentDicepoolMax) != null
          ? `${presentDicepoolValue ?? 0}/${presentDicepoolMax ?? "?"}`
          : "";

        group.entries.push({
          id: combatant.id,
          combatantId: combatant.id,
          tokenId: combatant.token?.id ?? combatant.tokenId,
          actorId: combatant.actor?.id,
          name: combatant.name,
          img: combatant.img,
          active: isActiveSide,
          defeated: combatant.defeated,
          hidden: combatant.hidden,
          dicepool: dicepoolDisplay,
          css: [
            isActiveSide ? "active" : "",
            combatant.defeated ? "defeated" : "",
            combatant.hidden ? "hidden" : "",
          ].filter(Boolean).join(" "),
          canPing: !!combatant.canPing,
          isOwner: !!combatant.isOwner,
        });
      }

      context.groupedTurns = groups;
    }

    return context;
  }

  async _beginSideCombat() {
    const combat = this.viewed;
    if (!combat?.isOwner) return;

    // Use the standard Foundry flow: users add combatants explicitly (toggle token combat state).
    // Starting side combat without combatants is allowed in core, but it doesn't make sense here.
    if ((combat.combatants?.size ?? 0) === 0) {
      ui.notifications.warn("Add combatants to the encounter first (toggle token combat state), then begin combat.");
      return;
    }

    const first = await this._promptFirstSide();
    if (!first) return;

    await combat.setFlag(FLAG_SCOPE, FLAG_FIRST, first);
    await combat.setFlag(FLAG_SCOPE, FLAG_ACTIVE, first);

    // advances to round 1 / turn 1
    await combat.startCombat();

    // Re-render only what changed
    await this.render({ parts: ["tracker", "footer"], force: true });
  }

  async _endSidePhase() {
    const combat = this.viewed;
    if (!combat?.isOwner || !combat.started) return;

    const active = (await combat.getFlag(FLAG_SCOPE, FLAG_ACTIVE)) ?? "investigators";
    const next = active === "investigators" ? "npcs" : "investigators";

    // Only advance the round after BOTH sides have completed their phase.
    // This means: increment when switching back to the first side.
    const first = (await combat.getFlag(FLAG_SCOPE, FLAG_FIRST)) ?? "investigators";
    const shouldAdvanceRound = next === first;

    if (shouldAdvanceRound) {
      const round = Number(combat.round) || 0;
      await combat.update({ round: round + 1 });
    }

    await combat.setFlag(FLAG_SCOPE, FLAG_ACTIVE, next);

    await this.render({ parts: ["tracker", "footer"], force: true });
  }

  async _promptFirstSide() {
    const { DialogV2 } = foundry.applications.api;
    return DialogV2.wait({
      window: { title: "Begin Combat" },
      content: `<p>Which side goes first?</p>`,
      buttons: [
        { action: "investigators", label: "Investigators", icon: "fa-solid fa-user" },
        { action: "npcs",          label: "NPCs",          icon: "fa-solid fa-skull" }
      ],
      rejectClose: false
    });
  }
}

function isDicepoolUpdate(changed) {
  const system = changed?.system;
  if (!system) return false;

  // Damage directly affects the effective dicepool max (max - damage), so re-render when it changes.
  if (Object.prototype.hasOwnProperty.call(system, "damage")) return true;

  const dicepool = system.dicepool;
  if (!dicepool) return false;

  return Object.prototype.hasOwnProperty.call(dicepool, "value")
    || Object.prototype.hasOwnProperty.call(dicepool, "max");
}

Hooks.on("updateActor", (actor, changed) => {
  if (!isDicepoolUpdate(changed)) return;

  const tracker = ui.combat;
  const combat = tracker?.viewed;
  if (!combat) return;

  const combatants = combat.combatants?.contents ?? [];
  if (!combatants.some(c => c.actorId === actor.id)) return;

  tracker.render({ parts: ["tracker"], force: true });
});
