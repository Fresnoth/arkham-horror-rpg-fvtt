// Injury/Trauma helper logic
// - Injury roll effects apply to skill rolls (DiceRollApp) as automatic penalties.
// - Injury roll (injury/trauma dialog) modifier is based on TOTAL injuries (instances).
// - Trauma roll modifier is based on enabled trauma flags.

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

const CANONICAL_SKILL_KEYS = [
  "agility",
  "athletics",
  "wits",
  "presence",
  "intuition",
  "knowledge",
  "resolve",
  "meleeCombat",
  "rangedCombat",
  "lore",
];

function normalizeSkillKey(key) {
  const raw = String(key ?? "").trim();
  if (!raw) return "";
  const rawLower = raw.toLowerCase();
  const match = CANONICAL_SKILL_KEYS.find(k => k.toLowerCase() === rawLower);
  return match ?? raw;
}

function normalizeRollKind(kind) {
  const k = String(kind ?? "complex");
  return k || "complex";
}

function isActiveItem(item) {
  // Backwards compatibility: legacy injuries/traumas may not have `system.active` yet.
  const v = item?.system?.active;
  return v === undefined ? true : Boolean(v);
}

function itemIdentityKey(item) {
  const sourceId = String(item?.flags?.core?.sourceId ?? "").trim();
  if (sourceId) return `source:${sourceId}`;

  // Fallback to name (best-effort). Not perfect, but stable for world documents.
  const name = String(item?.name ?? "").trim().toLowerCase();
  return `name:${name}`;
}

function groupByIdentity(items) {
  const map = new Map();
  for (const item of items) {
    const key = itemIdentityKey(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

function rollEffectAppliesToSkillRoll({ injury, rollState }) {
  const re = injury?.system?.rollEffects;
  if (!re?.enabled) return false;
  if (!isActiveItem(injury)) return false;

  const skillKey = normalizeSkillKey(rollState?.skillKey);
  const rollKind = normalizeRollKind(rollState?.rollKind);

  const skills = Array.isArray(re.skillKeys)
    ? re.skillKeys.map(normalizeSkillKey).filter(Boolean)
    : ["any"];
  const kinds = Array.isArray(re.rollKinds)
    ? re.rollKinds.map(String).filter(Boolean)
    : ["any"];

  const skillOk = skills.includes("any") || skills.includes(skillKey);

  // Tome rolls behave like complex skill rolls; treat as aliases.
  const kindAliases = rollKind.startsWith("tome-") ? [rollKind, "complex"] : [rollKind];
  const kindOk = kinds.includes("any") || kindAliases.some(k => kinds.includes(k));

  return skillOk && kindOk;
}

function getInjuryPenaltyValue(injury) {
  const n = Number(injury?.system?.rollEffects?.modifier?.penalty ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function getActiveInjuries(actor) {
  const items = actor?.items?.contents ?? [];
  return items.filter(i => i?.type === "injury" && isActiveItem(i));
}

export function getActiveTraumas(actor) {
  const items = actor?.items?.contents ?? [];
  return items.filter(i => i?.type === "trauma" && isActiveItem(i));
}

export function getTotalInjuryCount(actor) {
  return getActiveInjuries(actor).length;
}

export function getInjuryCountSummary(actor) {
  const injuries = getActiveInjuries(actor);
  const grouped = groupByIdentity(injuries);

  const entries = [];
  for (const [, group] of grouped.entries()) {
    if (!group?.length) continue;
    const name = String(group[0]?.name ?? "");
    entries.push({ name, count: group.length });
  }

  // stable ordering
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    total: injuries.length,
    entries,
    hasAny: entries.length > 0,
  };
}

/**
 * Compute injury penalties for a skill roll.
 *
 * - Groups injuries by identity so duplicates do NOT stack.
 * - If any instance in the identity group has enabled rollEffects that apply to this roll,
 *   the group contributes its penalty ONCE.
 * - If multiple enabled instances in the group apply, we take the maximum penalty (non-stacking).
 */
export function getInjuryImpactForSkillRoll({ actor, rollState } = {}) {
  const injuries = getActiveInjuries(actor);
  const grouped = groupByIdentity(injuries);

  const entries = [];
  let totalPenalty = 0;

  for (const [, group] of grouped.entries()) {
    if (!group?.length) continue;

    const matching = group.filter(i => rollEffectAppliesToSkillRoll({ injury: i, rollState }));
    if (matching.length === 0) continue;

    const penalty = Math.max(...matching.map(getInjuryPenaltyValue));
    if (penalty <= 0) continue;

    const name = String(group[0]?.name ?? "");
    totalPenalty += penalty;
    entries.push({ name, count: group.length, penalty });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    penalty: totalPenalty,
    entries,
    count: entries.length,
    hasAny: entries.length > 0,
  };
}

export function getTraumaRollModifierSummary(actor) {
  const traumas = getActiveTraumas(actor);

  const enabled = traumas.filter(t => Boolean(t?.system?.traumaRollModifier?.enabled));
  const grouped = groupByIdentity(enabled);

  const entries = [];
  for (const [, group] of grouped.entries()) {
    if (!group?.length) continue;
    const name = String(group[0]?.name ?? "");
    entries.push({ name, count: group.length, modifier: group.length });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const modifier = enabled.length;
  return {
    modifier,
    entries,
    total: enabled.length,
    hasAny: entries.length > 0,
  };
}

// Reserved for future: system flags should use SYSTEM_ID if we need to store derived state.
export { SYSTEM_ID };
