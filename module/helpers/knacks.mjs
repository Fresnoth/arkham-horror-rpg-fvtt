import { ROLL_EFFECT_ITEM_TYPES } from "../data/fields/roll-effects.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

const EFFECT_ITEM_TYPES = new Set(ROLL_EFFECT_ITEM_TYPES);

function isActorEmbeddedItem(item) {
  return !!item?.parent && item.parent instanceof Actor;
}

function normalizeGrants(knack) {
  const grants = Array.isArray(knack?.system?.grants) ? knack.system.grants : [];
  return grants
    .map(g => ({ type: String(g?.type ?? ""), uuid: String(g?.uuid ?? "") }))
    .filter(g => g.type === "spell" && !!g.uuid);
}

function getManagedSpellForGrant({ actor, grantUuid }) {
  const spells = actor.items?.contents ?? [];
  return spells.find(i => {
    if (i.type !== "spell") return false;
    const flags = i.flags?.[SYSTEM_ID] ?? {};
    if (flags?.grantKind !== "knack") return false;
    return String(flags?.grantSourceUuid ?? "") === String(grantUuid);
  }) ?? null;
}

function getGrantedByKnacks(spell) {
  const flags = spell?.flags?.[SYSTEM_ID] ?? {};
  const arr = flags?.grantedByKnackUuids;
  return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
}

async function createManagedSpellCopy({ actor, sourceSpell, grantUuid, grantingKnackUuid }) {
  const itemData = foundry.utils.deepClone(sourceSpell.toObject());
  delete itemData._id;

  itemData.flags = itemData.flags ?? {};
  itemData.flags.core = itemData.flags.core ?? {};

  // Keep core.sourceId for traceability, but do NOT dedupe against manual actor spells.
  // We dedupe only against spells that we mark as grantKind=knack.
  itemData.flags.core.sourceId = grantUuid;

  itemData.flags[SYSTEM_ID] = {
    ...(itemData.flags[SYSTEM_ID] ?? {}),

    grantKind: "knack",
    grantSourceUuid: grantUuid,
    grantedByKnackUuids: [grantingKnackUuid],
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  return created ?? null;
}

/**
 * Apply all spell grants from a newly-acquired knack.
 * - Creates embedded spell copies marked as grantKind=knack.
 * - Uses a single managed copy per grant UUID and reference-counts via grantedByKnackUuids.
 * - Intentionally does NOT adopt or modify manually dropped spells.
 */
export async function applyKnackGrantsOnAcquire({ actor, knack, notify = false } = {}) {
  if (!actor || !knack) return { createdCount: 0, updatedCount: 0 };
  if (knack.type !== "knack") return { createdCount: 0, updatedCount: 0 };

  const grants = normalizeGrants(knack);
  if (grants.length === 0) return { createdCount: 0, updatedCount: 0 };

  let createdCount = 0;
  let updatedCount = 0;

  for (const g of grants) {
    const grantUuid = g.uuid;

    const existingManaged = getManagedSpellForGrant({ actor, grantUuid });
    if (existingManaged) {
      const current = new Set(getGrantedByKnacks(existingManaged));
      if (!current.has(knack.uuid)) {
        current.add(knack.uuid);
        await existingManaged.update({
          [`flags.${SYSTEM_ID}.grantedByKnackUuids`]: Array.from(current),
        });
        updatedCount += 1;
      }
      continue;
    }

    let sourceSpell = null;
    try {
      sourceSpell = await fromUuid(grantUuid);
    } catch (e) {
      sourceSpell = null;
    }

    if (!sourceSpell || sourceSpell.type !== "spell") continue;

    const created = await createManagedSpellCopy({
      actor,
      sourceSpell,
      grantUuid,
      grantingKnackUuid: knack.uuid,
    });

    if (created) createdCount += 1;
  }

  if (notify) {
    if (createdCount > 0) ui.notifications?.info?.(`Granted ${createdCount} spell(s) from ${knack.name}.`);
  }

  return { createdCount, updatedCount };
}

/**
 * Remove spell grants for a deleted/unlearned knack.
 * - Removes the knack UUID from grantedByKnackUuids.
 * - Deletes the spell when no granting knacks remain.
 */
export async function removeKnackGrantedSpellsOnDelete({ actor, knack, notify = false } = {}) {
  if (!actor || !knack) return { deletedCount: 0, updatedCount: 0 };
  if (knack.type !== "knack") return { deletedCount: 0, updatedCount: 0 };

  const spells = actor.items?.contents ?? [];
  const toDeleteIds = [];
  const toUpdate = [];

  for (const spell of spells) {
    if (spell.type !== "spell") continue;

    const flags = spell.flags?.[SYSTEM_ID] ?? {};
    if (flags?.grantKind !== "knack") continue;

    const current = getGrantedByKnacks(spell);
    if (!current.includes(knack.uuid)) continue;

    const next = current.filter(u => u !== knack.uuid);
    if (next.length === 0) {
      toDeleteIds.push(spell.id);
    } else {
      toUpdate.push({
        _id: spell.id,
        [`flags.${SYSTEM_ID}.grantedByKnackUuids`]: next,
      });
    }
  }

  if (toUpdate.length > 0) await actor.updateEmbeddedDocuments("Item", toUpdate);
  if (toDeleteIds.length > 0) await actor.deleteEmbeddedDocuments("Item", toDeleteIds);

  if (notify) {
    if (toDeleteIds.length > 0) ui.notifications?.info?.(`Removed ${toDeleteIds.length} spell(s) granted by ${knack.name}.`);
  }

  return { deletedCount: toDeleteIds.length, updatedCount: toUpdate.length };
}

function rollEffectApplies({ item, rollState }) {
  const re = item?.system?.rollEffects;
  if (!re?.enabled) return false;

  const normalizeSkillKey = (key) => {
    const raw = String(key ?? "").trim();
    if (!raw) return "";

    // Canonical system skill keys (case-insensitive match).
    const canonical = [
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
    const rawLower = raw.toLowerCase();
    const match = canonical.find(k => k.toLowerCase() === rawLower);
    return match ?? raw;
  };

  const skillKey = normalizeSkillKey(rollState?.skillKey);
  const rollKind = String(rollState?.rollKind ?? "complex");

  const skills = Array.isArray(re.skillKeys)
    ? re.skillKeys.map(normalizeSkillKey).filter(Boolean)
    : ["any"];
  const kinds = Array.isArray(re.rollKinds) ? re.rollKinds.map(String) : ["any"];

  const skillOk = skills.includes("any") || skills.includes(skillKey);

  // Tome rolls are mechanically just skill rolls; treat them as "complex" for v1 applicability.
  // Keep explicit tome rollKinds working for any existing content.
  const kindAliases = rollKind.startsWith("tome-") ? [rollKind, "complex"] : [rollKind];
  const kindOk = kinds.includes("any") || kindAliases.some(k => kinds.includes(k));
  return skillOk && kindOk;
}

function isChargeBased(item) {
  const usage = item?.system?.usage ?? {};
  return Boolean(usage.decreaseAfterUsage) && (Number(usage.max ?? 0) || 0) > 0;
}

function hasLimitedFrequency(item) {
  const freq = String(item?.system?.usage?.frequency ?? "passive");
  return freq !== "passive" && freq !== "unlimited";
}

/**
 * Whether using this item costs one of its remaining uses. A limited frequency has always done so;
 * `decreaseAfterUsage` adds the charge case (First Aid Kit and friends) without changing what an
 * existing knack does.
 */
function consumesUse(item) {
  return hasLimitedFrequency(item) || isChargeBased(item);
}

function isUsableNow(item) {
  if (!consumesUse(item)) return true;
  return (Number(item?.system?.usage?.remaining ?? 0) || 0) > 0;
}

function getEffectItems(actor) {
  return (actor?.items?.contents ?? []).filter(i => EFFECT_ITEM_TYPES.has(i?.type));
}

/**
 * Returns items whose roll effects match the current roll, regardless of remaining uses.
 * Use this for UX (showing exhausted-but-applicable items) while keeping selection
 * validation based on `getApplicableEffectItemsForRoll`.
 */
export function getMatchingEffectItemsForRoll({ actor, rollState } = {}) {
  return getEffectItems(actor).filter(i => rollEffectApplies({ item: i, rollState }));
}

export function getApplicableEffectItemsForRoll({ actor, rollState } = {}) {
  return getMatchingEffectItemsForRoll({ actor, rollState }).filter(isUsableNow);
}

export function resolveSelectedEffectItems({ actor, selectedIds } = {}) {
  const ids = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  return getEffectItems(actor).filter(i => ids.has(String(i.id)));
}

export function isApplicableEffectItemSelection({ actor, rollState, itemIds } = {}) {
  const applicable = new Set(getApplicableEffectItemsForRoll({ actor, rollState }).map(i => String(i.id)));
  return (Array.isArray(itemIds) ? itemIds : []).every(id => applicable.has(String(id)));
}

/**
 * Sums the roll effects of the selected items.
 *
 * `addSuccesses` is the only new modifier that changes the roll itself (see `computeSkillOutcome`).
 * `healDamage`, `healInjury` and `reduceHorrorLimit` are carried along untouched — they are inputs
 * for the apply dialogs, not for the dice. `resolveHealEffects` in `helpers/healing.mjs` turns them
 * into the numbers `HealApp` works with.
 */
export function buildAppliedItemEffects({ selectedItems } = {}) {
  const list = Array.isArray(selectedItems) ? selectedItems : [];

  let bonusDiceDelta = 0;
  let resultModifierDelta = 0;
  let advantage = false;
  let disadvantage = false;
  let rerollAllowanceDice = 0;
  let addSuccesses = 0;
  let healDamage = 0;
  let healInjury = false;
  let reduceHorrorLimit = 0;

  const applied = [];

  for (const k of list) {
    const mod = k.system?.rollEffects?.modifier ?? {};

    bonusDiceDelta += Number(mod.addBonusDice ?? 0);
    resultModifierDelta += Number(mod.resultModifier ?? 0);
    if (mod.advantage) advantage = true;
    if (mod.disadvantage) disadvantage = true;
    rerollAllowanceDice += Number(mod.rerollAllowanceDice ?? 0);
    addSuccesses += Number(mod.addSuccesses ?? 0);
    healDamage += Number(mod.healDamage ?? 0);
    if (mod.healInjury) healInjury = true;
    reduceHorrorLimit += Number(mod.reduceHorrorLimit ?? 0);

    applied.push({
      itemId: k.id,
      itemUuid: k.uuid,
      name: k.name,
      itemType: String(k.type ?? ""),
      tier: Number(k.system?.tier ?? 0),
      frequency: String(k.system?.usage?.frequency ?? "passive"),
      spent: consumesUse(k),
      effects: {
        bonusDiceDelta: Number(mod.addBonusDice ?? 0),
        resultModifierDelta: Number(mod.resultModifier ?? 0),
        advantage: !!mod.advantage,
        disadvantage: !!mod.disadvantage,
        rerollAllowanceDice: Number(mod.rerollAllowanceDice ?? 0),
        addSuccesses: Number(mod.addSuccesses ?? 0),
        healDamage: Number(mod.healDamage ?? 0),
        healInjury: !!mod.healInjury,
        reduceHorrorLimit: Number(mod.reduceHorrorLimit ?? 0),
      }
    });
  }

  return {
    bonusDiceDelta,
    resultModifierDelta,
    advantage,
    disadvantage,
    rerollAllowanceDice,
    addSuccesses,
    healDamage,
    healInjury,
    reduceHorrorLimit,
    // `appliedKnacks` is the name the chat flags have carried since v1 and is kept for readers of
    // existing cards; `appliedItems` is the same array under the name that now fits.
    appliedItems: applied,
    appliedKnacks: applied,
  };
}

export async function spendItemUses({ actor, selectedItems } = {}) {
  const list = Array.isArray(selectedItems) ? selectedItems : [];
  const updates = [];

  for (const k of list) {
    if (!consumesUse(k)) continue;

    const remaining = Math.max(0, Number(k.system?.usage?.remaining ?? 0));
    if (remaining <= 0) continue;

    updates.push({
      _id: k.id,
      "system.usage.remaining": remaining - 1,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  return { updatedCount: updates.length };
}

/* -------------------------------------------- */
/*  Legacy knack-only names                      */
/* -------------------------------------------- */
// Kept so modules and macros written against the v1 helper surface keep working.

export const getMatchingKnacksForRoll = getMatchingEffectItemsForRoll;
export const getApplicableKnacksForRoll = getApplicableEffectItemsForRoll;

export function resolveSelectedKnacks({ actor, selectedKnackIds } = {}) {
  return resolveSelectedEffectItems({ actor, selectedIds: selectedKnackIds });
}

export function buildAppliedKnackEffects({ selectedKnacks } = {}) {
  return buildAppliedItemEffects({ selectedItems: selectedKnacks });
}

export function spendKnackUses({ actor, selectedKnacks } = {}) {
  return spendItemUses({ actor, selectedItems: selectedKnacks });
}

export function isApplicableKnackSelection({ actor, rollState, knackIds } = {}) {
  return isApplicableEffectItemSelection({ actor, rollState, itemIds: knackIds });
}
