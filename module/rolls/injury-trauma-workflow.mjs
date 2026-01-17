import { rollDice } from "../helpers/roll-engine.mjs";
import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

const FALLBACK_TABLES = {
  trauma: {
    standard: [
      { min: 1, max: 2, rangeLabel: "1–2", result: "Subtle Strangeness" },
      { min: 3, max: 3, rangeLabel: "3", result: "Shocked" },
      { min: 4, max: 4, rangeLabel: "4", result: "Stunned" },
      { min: 5, max: 7, rangeLabel: "5–7", result: "Overcome by Horror" },
      { min: 8, max: 10, rangeLabel: "8–10", result: "Mind Undone" },
      { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", result: "Lost Forever" },
    ],
    noPersonality: [
      { min: 1, max: 2, rangeLabel: "1–2", result: "Subtle Strangeness" },
      { min: 3, max: 4, rangeLabel: "3–4", result: "Shocked" },
      { min: 5, max: 7, rangeLabel: "5–7", result: "Stunned" },
      { min: 8, max: 10, rangeLabel: "8–10", result: "Mind Undone" },
      { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", result: "Lost Forever" },
    ],
  },
  injury: [
    { min: 1, max: 1, rangeLabel: "1", result: "Heavy Blow" },
    { min: 2, max: 2, rangeLabel: "2", result: "Slowed" },
    { min: 3, max: 3, rangeLabel: "3", result: "Nasty Cut" },
    { min: 4, max: 4, rangeLabel: "4", result: "Concussed" },
    { min: 5, max: 5, rangeLabel: "5", result: "Injured Arm" },
    { min: 6, max: 6, rangeLabel: "6", result: "Injured Leg" },
    { min: 7, max: 7, rangeLabel: "7", result: "Loss of a Sense" },
    { min: 8, max: 8, rangeLabel: "8", result: "Severely Injured" },
    { min: 9, max: 9, rangeLabel: "9", result: "Comatose" },
    { min: 10, max: 10, rangeLabel: "10", result: "Dire" },
    { min: 11, max: Number.POSITIVE_INFINITY, rangeLabel: "11+", result: "Dead" },
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
        const msg = "Falling mode only applies to Injury rolls.";
        warnOnce(`${SYSTEM_ID}|invalidFallingKind`, `[${SYSTEM_ID}] ${msg}`);
        throw new Error(msg);
      }
      if (fallingHeightFt < 10) {
        const msg = "Falling height must be at least 10 ft.";
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
          `[${SYSTEM_ID}] RollTable '${table?.name ?? primaryTableId}' has a matching range but empty result name. Set the RollTable Result Name, or the system will fall back to built-in tables.`
        );
        resolved = null;
      }
      if (resolved?.usedOverflowAssumption) {
        warnOnce(
          `${SYSTEM_ID}|overflow|${primaryTableId}`,
          `[${SYSTEM_ID}] RollTable '${table?.name ?? primaryTableId}' maxes at ${resolved.tableMax}; treating top entry as ${resolved.tableMax}+ for total ${total}.`
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
          `[${SYSTEM_ID}] RollTable '${table?.name ?? characterFallbackTableId}' has a matching range but empty result name. Set the RollTable Result Name, or the system will fall back to built-in tables.`
        );
        resolved = null;
      }
      if (resolved?.usedOverflowAssumption) {
        warnOnce(
          `${SYSTEM_ID}|overflow|${characterFallbackTableId}`,
          `[${SYSTEM_ID}] RollTable '${table?.name ?? characterFallbackTableId}' maxes at ${resolved.tableMax}; treating top entry as ${resolved.tableMax}+ for total ${total}.`
        );
      }
    }

    // Built-in fallback tables.
    const fallbackEntry = lookupFallbackEntry(rollKind, traumaVariant, total);
    const entry = resolved
      ? { rangeLabel: resolved.rangeLabel, resultName: resolved.resultName, resultDescription: resolved.resultDescription }
      : { rangeLabel: fallbackEntry?.rangeLabel, resultName: fallbackEntry?.result, resultDescription: "" };

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
      tableResultName: entry?.resultName ?? "No matching table entry",
      tableResultDescription: entry?.resultDescription ?? "",
    };
  }

  buildChat({ actor, outcome }) {
    const template = `systems/${SYSTEM_ID}/templates/chat/injury-trauma-roll-card.hbs`;

    const rollKindLabel = outcome.rollKind === "trauma" ? "Trauma" : "Injury";

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
