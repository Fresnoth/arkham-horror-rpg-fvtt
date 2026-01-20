const SYSTEM_ID = "arkham-horror-rpg-fvtt";

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

function rollEffectApplies({ knack, rollState }) {
  const re = knack?.system?.rollEffects;
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

function isKnackUsableNow(knack) {
  const freq = String(knack?.system?.usage?.frequency ?? "passive");
  if (freq === "passive" || freq === "unlimited") return true;
  const remaining = Number(knack?.system?.usage?.remaining ?? 0);
  return remaining > 0;
}

/**
 * Returns knacks whose roll effects match the current roll, regardless of remaining uses.
 * Use this for UX (showing exhausted-but-applicable knacks) while keeping selection
 * validation based on `getApplicableKnacksForRoll`.
 */
export function getMatchingKnacksForRoll({ actor, rollState } = {}) {
  const knacks = (actor?.items?.contents ?? []).filter(i => i.type === "knack");
  return knacks.filter(k => rollEffectApplies({ knack: k, rollState }));
}

export function getApplicableKnacksForRoll({ actor, rollState } = {}) {
  const knacks = getMatchingKnacksForRoll({ actor, rollState });
  return knacks.filter(isKnackUsableNow);
}

export function buildAppliedKnackEffects({ selectedKnacks } = {}) {
  const list = Array.isArray(selectedKnacks) ? selectedKnacks : [];

  let bonusDiceDelta = 0;
  let resultModifierDelta = 0;
  let advantage = false;
  let disadvantage = false;
  let rerollAllowanceDice = 0;

  const applied = [];

  for (const k of list) {
    const mod = k.system?.rollEffects?.modifier ?? {};

    bonusDiceDelta += Number(mod.addBonusDice ?? 0);
    resultModifierDelta += Number(mod.resultModifier ?? 0);
    if (mod.advantage) advantage = true;
    if (mod.disadvantage) disadvantage = true;
    rerollAllowanceDice += Number(mod.rerollAllowanceDice ?? 0);

    applied.push({
      itemId: k.id,
      itemUuid: k.uuid,
      name: k.name,
      tier: Number(k.system?.tier ?? 0),
      frequency: String(k.system?.usage?.frequency ?? "passive"),
      spent: (String(k.system?.usage?.frequency ?? "passive") !== "passive" && String(k.system?.usage?.frequency ?? "passive") !== "unlimited"),
      effects: {
        bonusDiceDelta: Number(mod.addBonusDice ?? 0),
        resultModifierDelta: Number(mod.resultModifier ?? 0),
        advantage: !!mod.advantage,
        disadvantage: !!mod.disadvantage,
        rerollAllowanceDice: Number(mod.rerollAllowanceDice ?? 0),
      }
    });
  }

  return {
    bonusDiceDelta,
    resultModifierDelta,
    advantage,
    disadvantage,
    rerollAllowanceDice,
    appliedKnacks: applied,
  };
}

export async function spendKnackUses({ actor, selectedKnacks } = {}) {
  const list = Array.isArray(selectedKnacks) ? selectedKnacks : [];
  const updates = [];

  for (const k of list) {
    const freq = String(k.system?.usage?.frequency ?? "passive");
    if (freq === "passive" || freq === "unlimited") continue;

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

export function resolveSelectedKnacks({ actor, selectedKnackIds } = {}) {
  const ids = Array.isArray(selectedKnackIds) ? selectedKnackIds : [];
  const byId = new Set(ids.map(String));
  return (actor?.items?.contents ?? []).filter(i => i.type === "knack" && byId.has(i.id));
}

export function isApplicableKnackSelection({ actor, rollState, knackIds } = {}) {
  const applicable = new Set(getApplicableKnacksForRoll({ actor, rollState }).map(k => k.id));
  return (Array.isArray(knackIds) ? knackIds : []).every(id => applicable.has(String(id)));
}
