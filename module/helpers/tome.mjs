const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function getTomeSpellUuids(tome) {
  return (tome?.system?.spellUuids ?? []).filter(u => !!u);
}

async function createActorSpellCopiesFromUuids({ actor, tome, uuids }) {
  const existing = (actor.items?.contents ?? []).filter(i => i.type === "spell");
  const existingSourceIds = new Set(existing.map(i => i.flags?.core?.sourceId).filter(Boolean));

  const toCreate = [];
  for (const uuid of uuids) {
    if (existingSourceIds.has(uuid)) continue;

    let source;
    try {
      source = await fromUuid(uuid);
    } catch (e) {
      source = null;
    }
    if (!source || source.type !== "spell") continue;

    const itemData = foundry.utils.deepClone(source.toObject());
    delete itemData._id;

    itemData.flags = itemData.flags ?? {};
    itemData.flags.core = itemData.flags.core ?? {};
    itemData.flags.core.sourceId = uuid;

    itemData.flags[SYSTEM_ID] = {
      ...(itemData.flags[SYSTEM_ID] ?? {}),
      tomeSourceItemId: tome.id,
      tomeSourceUuid: tome.uuid,
      tomeSourceName: tome.name,
    };

    toCreate.push(itemData);
  }

  if (toCreate.length > 0) {
    await actor.createEmbeddedDocuments("Item", toCreate);
  }

  return { createdCount: toCreate.length };
}

/**
 * Marks the Tome as understood and creates embedded spell copies on the actor.
 * Assumes all permission checks were already performed by the caller.
 */
export async function understandTomeAndLearnSpells({ actor, tome, notify = true }) {
  if (Boolean(tome?.system?.understood)) {
    if (notify) ui.notifications?.info?.("This Tome is already understood.");
    return { alreadyUnderstood: true, createdCount: 0 };
  }

  const uuids = getTomeSpellUuids(tome);

  await tome.update({ "system.understood": true });

  if (uuids.length === 0) {
    if (notify) ui.notifications?.info?.("This Tome has no spells to learn.");
    return { alreadyUnderstood: false, createdCount: 0, hadNoSpells: true };
  }

  const { createdCount } = await createActorSpellCopiesFromUuids({ actor, tome, uuids });

  if (notify) {
    if (createdCount > 0) {
      ui.notifications?.info?.(`Learned ${createdCount} spell(s) from the Tome.`);
    } else {
      ui.notifications?.info?.("No new spells were learned from this Tome.");
    }
  }

  return { alreadyUnderstood: false, createdCount, hadNoSpells: false };
}

/**
 * Attunes to a Tome and clears attuned on all other owned tomes.
 * Assumes all permission checks (and understood precondition) were already performed.
 */
export async function attuneTomeExclusive({ actor, tome, notify = true }) {
  const updates = [];
  for (const i of (actor.items?.contents ?? [])) {
    if (i.type !== "tome") continue;
    if (i.id === tome.id) continue;
    if (i.system?.attuned) updates.push({ _id: i.id, "system.attuned": false });
  }

  updates.push({ _id: tome.id, "system.attuned": true });
  await actor.updateEmbeddedDocuments("Item", updates);

  if (notify) ui.notifications?.info?.(`Attuned to ${tome.name}.`);
  return { updatedCount: updates.length };
}

/**
 * GM-only admin helper: clears understood and attuned state on a tome.
 * Intentionally does not delete learned spells on the actor.
 */
export async function clearTomeUnderstanding({ tome, notify = true }) {
  await tome.update({
    "system.understood": false,
    "system.attuned": false,
  });

  if (notify) ui.notifications?.info?.("Cleared Tome understanding.");
}
