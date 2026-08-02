// Defend helper logic (Core Rulebook p.30, details p.22)
// - A successful attack lets the target attempt exactly one reaction to avoid the hit.
// - Ranged attacks are avoided with Agility, melee attacks with Melee Combat.
// - Spells have no general reaction, so no reaction skill is derived for them.
// Pure functions only: no dialogs, no chat, no document writes.

const REACTION_SKILL_BY_ATTACK_SKILL = {
  rangedCombat: "agility",
  meleeCombat: "meleeCombat",
};

// "reroll" / "re-roll" / "rerolled" / "re-rolls" ...
const REROLL_PATTERN = /re-?roll/i;

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reaction skill for an attack, or null when the attack cannot be reacted to.
 * @param {object} options
 * @param {object|null} [options.weapon] Weapon item used for the attack.
 * @param {object|null} [options.spell]  Spell item used for the attack.
 * @returns {"agility"|"meleeCombat"|null}
 */
export function getReactionSkillForAttack({ weapon = null, spell = null } = {}) {
  // Core p.22: spells know no general dodge, only specific counter effects.
  if (spell) return null;
  if (!weapon) return null;

  const attackSkill = String(weapon?.system?.skill ?? "").trim();
  return REACTION_SKILL_BY_ATTACK_SKILL[attackSkill] ?? null;
}

/**
 * Can this actor react at all?
 * @param {object} options
 * @param {Actor|null} [options.actor]
 * @returns {{ok: boolean, reason: string|null, dicepool: number}}
 */
export function canDefend({ actor = null } = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED", dicepool: 0 };

  const dicepool = Math.max(0, Number(actor.system?.dicepool?.value ?? 0) || 0);
  // Core p.30: without dice in the pool no reaction is possible.
  if (dicepool <= 0) return { ok: false, reason: "NO_DICE", dicepool };

  return { ok: true, reason: null, dicepool };
}

/**
 * Snapshot of the currently targeted tokens, stored on the attack chat card.
 * @param {object} [options]
 * @param {User} [options.user]
 * @returns {Array<{tokenUuid: string, actorUuid: string, name: string, img: string}>}
 */
export function collectCurrentTargets({ user = game?.user } = {}) {
  const targeted = user?.targets;
  if (!targeted) return [];

  const snapshots = [];
  for (const token of targeted) {
    const tokenDoc = token?.document ?? token;
    const actor = token?.actor ?? tokenDoc?.actor ?? null;
    const tokenUuid = String(tokenDoc?.uuid ?? "");
    if (!tokenUuid) continue;

    snapshots.push({
      tokenUuid,
      actorUuid: String(actor?.uuid ?? ""),
      name: String(tokenDoc?.name ?? actor?.name ?? ""),
      img: String(actor?.img ?? tokenDoc?.texture?.src ?? ""),
    });
  }
  return snapshots;
}

/**
 * Protective equipment whose defensive benefit mentions a reroll
 * (Flowing Clothing, Improvised Shield, ... core p.89/90).
 * Display hint only - nothing is applied automatically.
 * @param {object} options
 * @param {Actor|null} [options.actor]
 * @returns {Array<{id: string, name: string, text: string}>}
 */
export function getDefenseRerollHints({ actor = null } = {}) {
  const items = actor?.items ?? [];
  const hints = [];

  for (const item of items) {
    if (item?.type !== "protective_equipment") continue;
    const text = stripHtml(item.system?.defensiveBenefit);
    if (!text || !REROLL_PATTERN.test(text)) continue;
    hints.push({ id: String(item.id ?? ""), name: String(item.name ?? ""), text });
  }

  return hints;
}
