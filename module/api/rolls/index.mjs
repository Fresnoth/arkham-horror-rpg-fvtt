import { DiceRollApp } from "../../apps/dice-roll-app.mjs";
import { InjuryTraumaRollApp } from "../../apps/injury-trauma-roll-app.mjs";

function getSkillSnapshot(actor, skillKey) {
  const key = String(skillKey ?? "").trim();
  const skillData = actor?.system?.skills?.[key];
  if (!key || !skillData) return null;

  return {
    skillKey: key,
    skillCurrent: Number(skillData.current ?? skillData.value ?? 0) || 0,
    skillMax: Number(skillData.max ?? 0) || 0,
    currentDicePool: Number(actor?.system?.dicepool?.value ?? actor?.system?.dicePool?.value ?? 0) || 0,
  };
}

export async function openSkillDialog(actor, {
  skillKey,
  rollKind = "complex",
  weaponToUse = null,
  spellToUse = null,
  successesNeeded,
  afterRoll,
  skillChoices,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const snapshot = getSkillSnapshot(actor, skillKey);
  if (!snapshot) {
    return {
      ok: false,
      reason: "SKILL_NOT_FOUND",
      skillKey: String(skillKey ?? ""),
    };
  }

  DiceRollApp.getInstance({
    actor,
    rollKind,
    skillKey: snapshot.skillKey,
    skillCurrent: snapshot.skillCurrent,
    skillMax: snapshot.skillMax,
    currentDicePool: snapshot.currentDicePool,
    weaponToUse,
    spellToUse,
    successesNeeded,
    afterRoll,
    skillChoices,
  }).render(true);

  return {
    ok: true,
    reason: null,
    rollKind: String(rollKind ?? "complex"),
    skillKey: snapshot.skillKey,
  };
}

export async function openReactionDialog(actor, {
  skillKey,
  rollKind = "reaction",
} = {}) {
  return openSkillDialog(actor, {
    skillKey,
    rollKind,
    weaponToUse: null,
    spellToUse: null,
  });
}

export async function openWeaponDialog(actor, {
  itemId,
  rollKind = "complex",
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const item = actor.items?.get?.(itemId);
  if (!item) return { ok: false, reason: "ITEM_NOT_FOUND", itemId: String(itemId ?? "") };

  const ammoMax = Number(item.system?.ammunition?.max ?? 0) || 0;
  const ammoCurrent = Number(item.system?.ammunition?.current ?? 0) || 0;
  if (ammoMax > 0 && ammoCurrent <= 0) {
    ui.notifications.warn(game.i18n.format("ARKHAM_HORROR.Warnings.WeaponOutOfAmmo", { itemName: item.name }));
    return { ok: false, reason: "WEAPON_OUT_OF_AMMO", itemId: String(item.id ?? itemId ?? "") };
  }

  const skillKey = String(item.system?.skill ?? "");
  const snapshot = getSkillSnapshot(actor, skillKey);
  if (!snapshot) {
    return {
      ok: false,
      reason: "SKILL_NOT_FOUND",
      itemId: String(item.id ?? itemId ?? ""),
      skillKey,
    };
  }

  return openSkillDialog(actor, {
    skillKey,
    rollKind,
    weaponToUse: item,
    spellToUse: null,
  });
}

export async function openSpellDialog(actor, {
  itemId,
  rollKind = "complex",
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const item = actor.items?.get?.(itemId);
  if (!item) return { ok: false, reason: "ITEM_NOT_FOUND", itemId: String(itemId ?? "") };

  const skillKey = String(item.system?.skill ?? "");
  const snapshot = getSkillSnapshot(actor, skillKey);
  if (!snapshot) {
    return {
      ok: false,
      reason: "SKILL_NOT_FOUND",
      itemId: String(item.id ?? itemId ?? ""),
      skillKey,
    };
  }

  return openSkillDialog(actor, {
    skillKey,
    rollKind,
    spellToUse: item,
    weaponToUse: null,
  });
}

export async function openInjuryTraumaDialog(actor, {
  rollKind = "injury",
  rollSource = "",
  modifier,
  dieFaces,
  rollMode,
  fallingHeightFt,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  InjuryTraumaRollApp.getInstance({
    actor,
    rollKind,
    rollSource,
    modifier,
    dieFaces,
    rollMode,
    fallingHeightFt,
  }).render(true);

  return {
    ok: true,
    reason: null,
    rollKind: String(rollKind ?? "injury"),
  };
}

export const rollsApi = {
  version: "v1",
  openSkillDialog,
  openReactionDialog,
  openWeaponDialog,
  openSpellDialog,
  openInjuryTraumaDialog,
};
