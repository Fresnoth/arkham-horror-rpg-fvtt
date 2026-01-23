import { rollDice } from "../helpers/roll-engine.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

const FALLBACK_TABLES = {
  trauma: {
    standard: [
      { min: 1, max: 2, rangeLabel: "1–2", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.SubtleStrangeness" },
      { min: 3, max: 3, rangeLabel: "3", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.Shocked" },
      { min: 4, max: 4, rangeLabel: "4", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.Stunned" },
      { min: 5, max: 7, rangeLabel: "5–7", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.OvercomeByHorror" },
      { min: 8, max: 10, rangeLabel: "8–10", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.MindUndone" },
      { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.LostForever" },
    ],
    noPersonality: [
      { min: 1, max: 2, rangeLabel: "1–2", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.SubtleStrangeness" },
      { min: 3, max: 4, rangeLabel: "3–4", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.Shocked" },
      { min: 5, max: 7, rangeLabel: "5–7", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.Stunned" },
      { min: 8, max: 10, rangeLabel: "8–10", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.MindUndone" },
      { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Trauma.LostForever" },
    ],
  },
  injury: [
    { min: 1, max: 1, rangeLabel: "1", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.HeavyBlow" },
    { min: 2, max: 2, rangeLabel: "2", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.Slowed" },
    { min: 3, max: 3, rangeLabel: "3", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.NastyCut" },
    { min: 4, max: 4, rangeLabel: "4", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.Concussed" },
    { min: 5, max: 5, rangeLabel: "5", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.InjuredArm" },
    { min: 6, max: 6, rangeLabel: "6", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.InjuredLeg" },
    { min: 7, max: 7, rangeLabel: "7", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.LossOfASense" },
    { min: 8, max: 8, rangeLabel: "8", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.SeverelyInjured" },
    { min: 9, max: 9, rangeLabel: "9", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.Comatose" },
    { min: 10, max: 10, rangeLabel: "10", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.Dire" },
    { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", resultKey: "ARKHAM_HORROR.InjuryTrauma.Fallback.Injury.Dead" },
  ],
};

const warnOnceKeys = new Set();

function normalizeKind(kind) {
  const k = String(kind ?? "").toLowerCase();
  if (k === "injury" || k === "trauma") return k;
  return "injury";
}

function normalizeRollMode(mode) {
  const m = String(mode ?? "standard").toLowerCase();
  if (m === "falling") return "falling";
  return "standard";
}

function normalizeRollSource(source) {
  const s = String(source ?? "").toLowerCase();
  if (s === "strain") return "strain";
  return "";
}

function lookupFallbackEntry(kind, traumaVariant, total) {
  const t = Number(total);
  if (kind === "trauma") {
    const entries = FALLBACK_TABLES.trauma[traumaVariant] ?? FALLBACK_TABLES.trauma.standard;
    return entries.find(e => t >= e.min && t <= e.max) ?? null;
  }
  const entries = FALLBACK_TABLES.injury;
  return entries.find(e => t >= e.min && t <= e.max) ?? null;
}

function localizeFallbackResultName(entry) {
  const key = entry?.resultKey;
  if (!key) return game.i18n.localize("ARKHAM_HORROR.InjuryTrauma.Fallback.NoMatchingEntry");
  return game.i18n.localize(key);
}

function warnOnce(key, message) {
  if (warnOnceKeys.has(key)) return;
  warnOnceKeys.add(key);

  // Surface to the GM in the UI (but don't spam players).
  try {
    if (game?.user?.isGM && ui?.notifications?.warn) {
      ui.notifications.warn(message);
    }
  } catch (e) {
    // ignore
  }

  // eslint-disable-next-line no-console
  console.warn(message);
}

function getActorCategory(actor) {
  const type = actor?.type;
  if (type === "npc") return "npc";
  return "character";
}

function getTraumaVariantSetting() {
  const v = String(game.settings.get(SYSTEM_ID, "characterTraumaTableVariant") ?? "standard");
  return v === "noPersonality" ? "noPersonality" : "standard";
}

function getConfiguredTableId({ actorCategory, kind, traumaVariant }) {
  if (kind === "injury") {
    if (actorCategory === "npc") return game.settings.get(SYSTEM_ID, "npcInjuryTable") || "";
    return game.settings.get(SYSTEM_ID, "characterInjuryTable") || "";
  }

  // trauma (uses existing "horror" settings)
  if (actorCategory === "npc") return game.settings.get(SYSTEM_ID, "npcHorrorTable") || "";
  if (traumaVariant === "noPersonality") return game.settings.get(SYSTEM_ID, "characterHorrorTableNoPersonality") || "";
  return game.settings.get(SYSTEM_ID, "characterHorrorTable") || "";
}

function getConfiguredCharacterFallbackTableId({ kind, traumaVariant }) {
  if (kind === "injury") return game.settings.get(SYSTEM_ID, "characterInjuryTable") || "";
  if (traumaVariant === "noPersonality") return game.settings.get(SYSTEM_ID, "characterHorrorTableNoPersonality") || "";
  return game.settings.get(SYSTEM_ID, "characterHorrorTable") || "";
}

function resolveFromRollTableByTotal({ rollTable, total }) {
  if (!rollTable) return null;
  const results = Array.from(rollTable.results ?? []);
  if (results.length === 0) return null;

  const t = Number(total);
  const match = results.find(r => {
    const min = Number(r?.range?.[0]);
    const max = Number(r?.range?.[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
    return t >= min && t <= max;
  });
  if (match) {
    const [min, max] = match.range;
    const rangeLabel = min === max ? String(min) : `${min}–${max}`;
    const name = String(match.name ?? "").trim();
    const description = String(match.description ?? "").trim();
    if (!name) {
      return { rangeLabel, resultName: "", resultDescription: description, missingName: true };
    }
    return { rangeLabel, resultName: name, resultDescription: description };
  }

  // Safe hybrid overflow:
  // If total is above the maximum range, treat the *single-value* top entry (max==min==tableMax) as "tableMax+".
  let tableMax = Number.NEGATIVE_INFINITY;
  for (const r of results) {
    const max = Number(r?.range?.[1]);
    if (Number.isFinite(max) && max > tableMax) tableMax = max;
  }
  if (!Number.isFinite(tableMax)) return null;

  if (t > tableMax) {
    const topSingle = results.find(r => Number(r?.range?.[0]) === tableMax && Number(r?.range?.[1]) === tableMax);
    if (topSingle) {
      const name = String(topSingle.name ?? "").trim();
      const description = String(topSingle.description ?? "").trim();
      if (!name) {
        return {
          rangeLabel: `${tableMax}+`,
          resultName: "",
          resultDescription: description,
          usedOverflowAssumption: true,
          tableMax,
          missingName: true,
        };
      }
      return {
        rangeLabel: `${tableMax}+`,
        resultName: name,
        resultDescription: description,
        usedOverflowAssumption: true,
        tableMax,
      };
    }
  }

  return null;
}

export class InjuryTraumaWorkflow {
  async execute({ actor, state }) {
    const rollKind = normalizeKind(state?.rollKind);
    const rollMode = normalizeRollMode(state?.rollMode);
    const rollSource = normalizeRollSource(state?.rollSource);

    const requestedFaces = Number.parseInt(state?.dieFaces) || 6;
    const dieFaces = rollMode === "falling" ? 3 : (requestedFaces === 3 ? 3 : 6);

    const fallingHeightFt = Number.parseInt(state?.fallingHeightFt) || 0;

    // Validate at the source of truth (workflow), not only in the UI.
    // This protects against macros/future automation calling the workflow directly.
    if (rollMode === "falling") {
      if (rollKind !== "injury") {
        const msg = game.i18n.localize("ARKHAM_HORROR.Warnings.InjuryTraumaFallingModeInjuryOnly");
        warnOnce(`${SYSTEM_ID}|invalidFallingKind`, `[${SYSTEM_ID}] ${msg}`);
        throw new Error(msg);
      }
      if (fallingHeightFt < 10) {
        const msg = game.i18n.format("ARKHAM_HORROR.Warnings.InjuryTraumaFallingHeightMin", { minFt: 10 });
        warnOnce(`${SYSTEM_ID}|invalidFallingHeight`, `[${SYSTEM_ID}] ${msg}`);
        throw new Error(msg);
      }
    }

    const numDice = rollMode === "falling"
      ? Math.floor(fallingHeightFt / 10)
      : 1;

    const modifierApplied = rollMode !== "falling";
    const modifier = modifierApplied ? (Number.parseInt(state?.modifier) || 0) : 0;

    const roll = await rollDice({ actor, numDice, faces: dieFaces });
    const dieResults = Array.isArray(roll.results) ? roll.results.map(r => Number(r) || 0) : [];
    const dieTotal = dieResults.reduce((sum, r) => sum + (Number(r) || 0), 0);
    const dieResult = Number(dieResults?.[0] ?? 0);

    const total = dieTotal + modifier;

    const actorCategory = getActorCategory(actor);
    const traumaVariant = getTraumaVariantSetting();

    const primaryTableId = getConfiguredTableId({ actorCategory, kind: rollKind, traumaVariant });
    const characterFallbackTableId = actorCategory === "npc"
      ? getConfiguredCharacterFallbackTableId({ kind: rollKind, traumaVariant })
      : "";

    let resolved = null;

    if (primaryTableId) {
      const table = game.tables.get(primaryTableId);
      resolved = resolveFromRollTableByTotal({ rollTable: table, total });
      if (resolved?.missingName) {
        warnOnce(
          `${SYSTEM_ID}|missingName|${primaryTableId}`,
          game.i18n.format("ARKHAM_HORROR.Warnings.RollTableEmptyResultName", {
            tableName: table?.name ?? primaryTableId,
          })
        );
        resolved = null;
      }
      if (resolved?.usedOverflowAssumption) {
        warnOnce(
          `${SYSTEM_ID}|overflow|${primaryTableId}`,
          game.i18n.format("ARKHAM_HORROR.Warnings.RollTableOverflowAssumption", {
            tableName: table?.name ?? primaryTableId,
            tableMax: resolved.tableMax,
            total,
          })
        );
      }
    }

    // If NPC-specific table isn't set/usable, fall back to the configured character table.
    if (!resolved && actorCategory === "npc" && characterFallbackTableId) {
      const table = game.tables.get(characterFallbackTableId);
      resolved = resolveFromRollTableByTotal({ rollTable: table, total });
      if (resolved?.missingName) {
        warnOnce(
          `${SYSTEM_ID}|missingName|${characterFallbackTableId}`,
          game.i18n.format("ARKHAM_HORROR.Warnings.RollTableEmptyResultName", {
            tableName: table?.name ?? characterFallbackTableId,
          })
        );
        resolved = null;
      }
      if (resolved?.usedOverflowAssumption) {
        warnOnce(
          `${SYSTEM_ID}|overflow|${characterFallbackTableId}`,
          game.i18n.format("ARKHAM_HORROR.Warnings.RollTableOverflowAssumption", {
            tableName: table?.name ?? characterFallbackTableId,
            tableMax: resolved.tableMax,
            total,
          })
        );
      }
    }

    // Built-in fallback tables.
    const fallbackEntry = lookupFallbackEntry(rollKind, traumaVariant, total);
    const entry = resolved
      ? { rangeLabel: resolved.rangeLabel, resultName: resolved.resultName, resultDescription: resolved.resultDescription }
      : { rangeLabel: fallbackEntry?.rangeLabel, resultName: localizeFallbackResultName(fallbackEntry), resultDescription: "" };

    return {
      rollKind,
      rollMode,
      rollSource,
      dieFaces,
      numDice,
      dieResults,
      dieResultsLabel: dieResults.join(", "),
      dieTotal,
      modifierApplied,
      fallingHeightFt: rollMode === "falling" ? fallingHeightFt : null,
      dieResult,
      modifier,
      total,
      tableRange: entry?.rangeLabel ?? "—",
      tableResultName: entry?.resultName ?? game.i18n.localize("ARKHAM_HORROR.InjuryTrauma.Fallback.NoMatchingEntry"),
      tableResultDescription: entry?.resultDescription ?? "",
    };
  }

  buildChat({ actor, outcome }) {
    const template = `systems/${SYSTEM_ID}/templates/chat/injury-trauma-roll-card.hbs`;

    const rollKindLabel = game.i18n.localize(`TYPES.Item.${outcome.rollKind === "trauma" ? "trauma" : "injury"}`);

    const chatData = {
      actorName: actor?.name ?? "",
      rollKind: outcome.rollKind,
      rollKindLabel,
      rollMode: outcome.rollMode,
      rollSource: outcome.rollSource,
      dieFaces: outcome.dieFaces,
      numDice: outcome.numDice,
      dieResults: outcome.dieResults,
      dieResultsLabel: outcome.dieResultsLabel,
      dieTotal: outcome.dieTotal,
      modifierApplied: outcome.modifierApplied,
      fallingHeightFt: outcome.fallingHeightFt,
      dieResult: outcome.dieResult,
      modifier: outcome.modifier,
      total: outcome.total,
      tableRange: outcome.tableRange,
      tableResultName: outcome.tableResultName,
      tableResultDescription: outcome.tableResultDescription,
    };

    return { template, chatData };
  }

  async post({ actor, outcome }) {
    const { template, chatData } = this.buildChat({ actor, outcome });

    const flags = {
      [SYSTEM_ID]: {
        ...chatData,
        rollCategory: "injury-trauma",
      },
    };

    return createArkhamHorrorChatCard({ actor, template, chatVars: chatData, flags });
  }

  async run({ actor, state }) {
    const outcome = await this.execute({ actor, state });
    const posted = await this.post({ actor, outcome });
    return { outcome, ...posted };
  }
}
