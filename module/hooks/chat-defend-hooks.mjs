import { openReactionDialog } from "../api/rolls/index.mjs";
import { canDefend, getDefenseRerollHints } from "../helpers/defend.mjs";
import { getDefaultDamage, shouldInflictInjury } from "../helpers/damage.mjs";
import { ApplyDamageApp } from "../apps/apply-damage-app.mjs";
import { HealApp } from "../apps/heal-app.mjs";
import { resolveHealEffects } from "../helpers/healing.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

const REASON_LABELS = {
  ACTOR_REQUIRED: "ARKHAM_HORROR.DEFEND.ReasonActorNotFound",
  ACTOR_NOT_FOUND: "ARKHAM_HORROR.DEFEND.ReasonActorNotFound",
  ATTACK_MISSED: "ARKHAM_HORROR.DEFEND.ReasonAttackMissed",
  NO_DICE: "ARKHAM_HORROR.DEFEND.ReasonNoDice",
  SKILL_NOT_FOUND: "ARKHAM_HORROR.DEFEND.ReasonSkillNotFound",
};

function localizeReason(reason) {
  const key = REASON_LABELS[String(reason ?? "")] ?? "ARKHAM_HORROR.DEFEND.ReasonUnavailable";
  return game.i18n.localize(key);
}

function localizeDamageReason(reason) {
  const key = `ARKHAM_HORROR.DAMAGE.Reasons.${String(reason ?? "")}`;
  const label = game.i18n.localize(key);
  return label === key ? game.i18n.localize("ARKHAM_HORROR.DAMAGE.Reasons.UNAVAILABLE") : label;
}

function localizeHealReason(reason) {
  const key = `ARKHAM_HORROR.HEALING.Reasons.${String(reason ?? "")}`;
  const label = game.i18n.localize(key);
  return label === key ? game.i18n.localize("ARKHAM_HORROR.HEALING.Reasons.UNAVAILABLE") : label;
}

/**
 * "May this client act for the target?" — used for reactions, damage and healing alike: all three
 * write to the target actor.
 */
function canUserDefend({ actor }) {
  if (game.user?.isGM) return true;
  return !!actor?.isOwner;
}

function resolveTargetActorSync({ tokenUuid, actorUuid }) {
  const sync = foundry.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  if (typeof sync !== "function") return null;

  try {
    const tokenDoc = tokenUuid ? sync(tokenUuid) : null;
    if (tokenDoc?.actor) return tokenDoc.actor;
  } catch (e) {
    // ignore
  }
  try {
    const actor = actorUuid ? sync(actorUuid) : null;
    if (actor instanceof Actor) return actor;
  } catch (e) {
    // ignore
  }
  return null;
}

async function resolveTargetActor({ tokenUuid, actorUuid }) {
  try {
    const tokenDoc = tokenUuid ? await fromUuid(tokenUuid) : null;
    if (tokenDoc?.actor) return tokenDoc.actor;
  } catch (e) {
    // ignore
  }
  try {
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (actor instanceof Actor) return actor;
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * A reroll posts a new card that inherits the target list, so all cards of one
 * attack are collapsed onto the id of the original attack card. Without this a
 * target could react once per reroll.
 */
function resolveAttackRootMessage(message) {
  let current = message;
  const seen = new Set();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const sourceId = current.flags?.[SYSTEM_ID]?.rerollSourceMessageId;
    if (!sourceId) break;
    const source = game.messages?.get?.(sourceId);
    if (!source) break;
    current = source;
  }

  return current ?? message;
}

/**
 * Which targets already reacted to this attack, keyed by token UUID.
 * The reaction chat cards are the authority: a defending player is usually not
 * allowed to write to an attack card authored by somebody else, so the mirrored
 * `defenses` flag on the attack card can only ever be a best-effort copy.
 */
function collectDefenses({ attackMessage }) {
  const byTarget = new Map();
  const flags = attackMessage?.flags?.[SYSTEM_ID];

  for (const entry of Array.isArray(flags?.defenses) ? flags.defenses : []) {
    const uuid = String(entry?.targetUuid ?? "");
    if (!uuid) continue;
    byTarget.set(uuid, {
      isSuccess: !!entry?.isSuccess,
      messageId: entry?.messageId ?? null,
    });
  }

  for (const msg of game.messages ?? []) {
    const msgFlags = msg?.flags?.[SYSTEM_ID];
    if (!msgFlags || msgFlags.respondsTo !== attackMessage.id) continue;
    const uuid = String(msgFlags.defendTargetUuid ?? "");
    if (!uuid) continue;
    byTarget.set(uuid, { isSuccess: !!msgFlags.isSuccess, messageId: msg.id });
  }

  return byTarget;
}

function showRerollHint({ hintEl, actor }) {
  if (!hintEl || !actor) return;
  const hints = getDefenseRerollHints({ actor });
  if (hints.length === 0) return;

  hintEl.textContent = game.i18n.format("ARKHAM_HORROR.DEFEND.RerollHint", {
    items: hints.map(h => h.name).join(", "),
  });
  hintEl.dataset.tooltip = hints.map(h => `${h.name}: ${h.text}`).join("\n");
  hintEl.hidden = false;
}

function markDefended({ row, btn, statusEl, defense }) {
  row.classList.add("is-defended");
  if (btn) btn.remove();
  if (!statusEl) return;

  statusEl.textContent = game.i18n.localize(defense.isSuccess
    ? "ARKHAM_HORROR.DEFEND.StatusAvoided"
    : "ARKHAM_HORROR.DEFEND.StatusNotAvoided");
  statusEl.classList.add(defense.isSuccess ? "is-avoided" : "is-not-avoided");
  statusEl.hidden = false;
}

/**
 * Records the reaction on both cards.
 * The reaction card carries the authoritative back-reference; the attack card is
 * only updated when this client may write to it (author or GM).
 */
async function linkReaction({ attackMessage, reactionMessage, tokenUuid, targetName, skillKey }) {
  const isSuccess = !!reactionMessage?.flags?.[SYSTEM_ID]?.isSuccess;

  try {
    await reactionMessage?.update?.({
      [`flags.${SYSTEM_ID}.respondsTo`]: attackMessage.id,
      [`flags.${SYSTEM_ID}.defendTargetUuid`]: tokenUuid,
      [`flags.${SYSTEM_ID}.defendTargetName`]: targetName,
      [`flags.${SYSTEM_ID}.defendAttackerName`]: String(attackMessage?.speaker?.alias ?? ""),
      [`flags.${SYSTEM_ID}.defendSkillKey`]: skillKey,
    });
  } catch (e) {
    ui.notifications?.warn?.(game.i18n.localize("ARKHAM_HORROR.DEFEND.LinkFailed"));
    return;
  }

  if (!(game.user?.isGM || attackMessage?.isAuthor)) return;

  const previous = Array.isArray(attackMessage?.flags?.[SYSTEM_ID]?.defenses)
    ? attackMessage.flags[SYSTEM_ID].defenses
    : [];
  const defenses = previous.filter(e => String(e?.targetUuid ?? "") !== tokenUuid);
  defenses.push({
    targetUuid: tokenUuid,
    targetName,
    messageId: reactionMessage?.id ?? null,
    skillKey,
    isSuccess,
  });

  try {
    await attackMessage.update({ [`flags.${SYSTEM_ID}.defenses`]: defenses });
  } catch (e) {
    // Non-fatal: the reaction card alone is enough to derive the defended state.
  }
}

async function startDefense({ attackMessage, flags, tokenUuid, actorUuid, targetName }) {
  const actor = await resolveTargetActor({ tokenUuid, actorUuid });
  if (!actor) {
    ui.notifications?.warn?.(localizeReason("ACTOR_NOT_FOUND"));
    return;
  }
  if (!canUserDefend({ actor })) {
    ui.notifications?.warn?.(game.i18n.localize("ARKHAM_HORROR.Warnings.PermissionRollActor"));
    return;
  }

  const check = canDefend({ actor });
  if (!check.ok) {
    ui.notifications?.warn?.(localizeReason(check.reason));
    return;
  }

  const skillKey = String(flags?.defendSkillKey ?? "");
  const opened = await openReactionDialog(actor, {
    skillKey,
    afterRoll: async ({ message: reactionMessage }) => {
      if (!reactionMessage) return;
      await linkReaction({ attackMessage, reactionMessage, tokenUuid, targetName, skillKey });
    },
  });
  if (!opened?.ok) ui.notifications?.warn?.(localizeReason(opened?.reason));
}

/**
 * Opens the apply-damage dialog for one target of an attack card.
 * The defaults come from the attack itself (core p. 30): the weapon's damage and, when the
 * successes reach the injury rating, a pre-ticked injury box. Both stay editable — damage
 * reduction is rules text and is never calculated here (REGELN.md, "Schadensreduktion").
 */
async function startApplyDamage({ message, flags, tokenUuid, actorUuid, targetName }) {
  const actor = await resolveTargetActor({ tokenUuid, actorUuid });
  if (!actor) {
    ui.notifications?.warn?.(localizeDamageReason("ACTOR_NOT_FOUND"));
    return;
  }
  if (!canUserDefend({ actor })) {
    ui.notifications?.warn?.(localizeDamageReason("PERMISSION_DENIED"));
    return;
  }

  let weapon = null;
  try {
    weapon = flags?.weaponUuid ? await fromUuid(flags.weaponUuid) : null;
  } catch (e) {
    // The weapon may live on an actor this client cannot read; the flags carry enough to proceed.
  }

  // Spells can inflict horror on the target; the dialog pre-fills the field from it.
  let spell = null;
  try {
    spell = flags?.spellUuid ? await fromUuid(flags.spellUuid) : null;
  } catch (e) {
    // Same as above — the flags carry the rules text as a fallback.
  }

  const successes = Number(flags?.successCount ?? 0) || 0;
  const amount = weapon ? getDefaultDamage({ weapon }) : Number(flags?.weaponDamage ?? 0) || 0;
  const inflictInjury = weapon
    ? shouldInflictInjury({ successes, weapon })
    : !!flags?.weaponInflictInjury;

  ApplyDamageApp.getInstance({
    actor,
    amount,
    // `horror` deliberately NOT set: the dialog then derives the value itself from the flags or
    // the spell (`getDefaultHorror`). A hard 0 here would defeat that derivation.
    flags,
    spell,
    inflictInjury,
    successes,
    injuryRating: weapon ? Number(weapon.system?.injuryRating ?? 0) || 0 : null,
    attackerName: String(message?.speaker?.alias ?? ""),
    weaponName: String(weapon?.name ?? flags?.weaponUsed?.name ?? ""),
    targetName,
    source: "chat",
  }).render(true);
}

function decorateDamageButton({ message, flags, row, actor, targetName, attackHit, defense }) {
  const btn = row.querySelector('[data-action="arkham-apply-damage"]');
  if (!btn) return;

  // A missed attack deals nothing at all, so the button stays hidden rather than disabled.
  if (!attackHit || !canUserDefend({ actor })) {
    btn.style.display = "none";
    return;
  }

  let reason = null;
  if (!actor) reason = "ACTOR_NOT_FOUND";
  // Core p. 30: a successful reaction means the attack does not hit after all.
  else if (defense?.isSuccess) reason = "DEFENDED";

  if (reason) {
    btn.disabled = true;
    btn.dataset.tooltip = localizeDamageReason(reason);
    return;
  }

  btn.dataset.tooltip = game.i18n.localize("ARKHAM_HORROR.DAMAGE.Tooltip");

  if (btn.dataset.arkhamDamageBound === "1") return;
  btn.dataset.arkhamDamageBound = "1";

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await startApplyDamage({
      message,
      flags,
      tokenUuid: String(btn.dataset.targetUuid ?? ""),
      actorUuid: String(btn.dataset.actorUuid ?? ""),
      targetName,
    });
  });
}

function decorateDefendSection(message, html) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!flags || flags.rollCategory !== "skill") return;

  const rows = html?.querySelectorAll?.(".arkham-defend-row");
  if (!rows?.length) return;

  const attackMessage = resolveAttackRootMessage(message);
  const defenses = collectDefenses({ attackMessage });
  // Reroll cards inherit `attackHit` from the original roll, but recompute
  // `weaponUsageSuccess`, so the latter is the more reliable source.
  const attackHit = flags.weaponUsageSuccess !== undefined
    ? !!flags.weaponUsageSuccess
    : !!flags.attackHit;

  for (const row of rows) {
    const btn = row.querySelector('[data-action="arkham-defend"]');
    const statusEl = row.querySelector('[data-role="defendStatus"]');
    const hintEl = row.querySelector('[data-role="defendHint"]');

    const tokenUuid = String(row.dataset.targetUuid ?? "");
    const actorUuid = String(row.dataset.actorUuid ?? "");
    const targetName = String(row.querySelector("[data-target-name]")?.dataset?.targetName ?? "");
    const actor = resolveTargetActorSync({ tokenUuid, actorUuid });

    const defense = defenses.get(tokenUuid);

    // Damage is decorated first: it stays available after a failed reaction, so it must not be
    // skipped by the early exits below.
    decorateDamageButton({ message, flags, row, actor, targetName, attackHit, defense });

    // One reaction per attack and target.
    if (defense) {
      markDefended({ row, btn, statusEl, defense });
      continue;
    }

    if (!canUserDefend({ actor })) {
      if (btn) btn.style.display = "none";
      continue;
    }
    if (!btn) continue;

    showRerollHint({ hintEl, actor });

    let reason = null;
    if (!actor) reason = "ACTOR_NOT_FOUND";
    else if (!attackHit) reason = "ATTACK_MISSED";
    else {
      const check = canDefend({ actor });
      if (!check.ok) reason = check.reason;
    }

    if (reason) {
      btn.disabled = true;
      btn.dataset.tooltip = localizeReason(reason);
      continue;
    }

    if (btn.dataset.arkhamDefendBound === "1") continue;
    btn.dataset.arkhamDefendBound = "1";

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await startDefense({ attackMessage, flags, tokenUuid, actorUuid, targetName });
    });
  }
}

/**
 * Opens the heal dialog for one target of a healing roll (core p. 33-34, p. 38).
 * The successes travel with the card, so the dialog can pre-fill the amount (1 damage per success)
 * and grey out injuries that need more successes than were rolled.
 */
async function startApplyHealing({ flags, tokenUuid, actorUuid, targetName, successes, succeeded }) {
  const actor = await resolveTargetActor({ tokenUuid, actorUuid });
  if (!actor) {
    ui.notifications?.warn?.(localizeHealReason("ACTOR_NOT_FOUND"));
    return;
  }
  if (!canUserDefend({ actor })) {
    ui.notifications?.warn?.(localizeHealReason("PERMISSION_DENIED"));
    return;
  }

  let healer = null;
  try {
    healer = flags?.healerUuid ? await fromUuid(flags.healerUuid) : null;
  } catch (e) {
    // The healer may live in a compendium or on a token this client cannot read; the flags carry
    // the name, which is all the dialog needs.
  }

  const rollKind = String(flags?.healRollKind ?? "heal-damage");

  HealApp.getInstance({
    actor,
    healer: healer instanceof Actor ? healer : null,
    healerName: String(flags?.healerName ?? ""),
    rollKind,
    successes,
    // The `effect*` flags were carried by the card but never read until now (core p. 33-34, p. 38).
    effects: resolveHealEffects({ rollKind, successes, flags: flags ?? {} }),
    rollSucceeded: succeeded,
    targetName,
    source: "chat",
  }).render(true);
}

function decorateHealSection(message, html) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!flags?.showHealSection) return;

  const rows = html?.querySelectorAll?.(".arkham-heal-row");
  if (!rows?.length) return;

  // Read from the card's own roll result, not from a copy: a reroll card inherits the heal flags
  // but recomputes these two.
  const successes = Math.max(0, Number(flags.successCount ?? 0) || 0);
  // `isSuccess` is `successCount >= successesNeeded` and therefore true at zero successes when no
  // difficulty was set — but "if they succeed" (core p. 33/38) needs at least one success.
  const succeeded = successes > 0 && flags.isSuccess !== false;

  for (const row of rows) {
    const btn = row.querySelector('[data-action="arkham-apply-healing"]');
    if (!btn) continue;

    const tokenUuid = String(row.dataset.targetUuid ?? "");
    const actorUuid = String(row.dataset.actorUuid ?? "");
    const targetName = String(row.querySelector(".arkham-heal-target-name")?.textContent?.trim() ?? "");
    const actor = resolveTargetActorSync({ tokenUuid, actorUuid });

    // Only the owner of the target (or the GM) may apply anything to it.
    if (!canUserDefend({ actor })) {
      btn.style.display = "none";
      continue;
    }

    let reason = null;
    if (!actor) reason = "ACTOR_NOT_FOUND";
    // Core p. 38: horror only drops on a success; core p. 33: damage heals per success.
    else if (flags.healIsHorror && !succeeded) reason = "ROLL_FAILED";
    else if (!flags.healIsHorror && successes <= 0) reason = "NO_SUCCESSES";

    if (reason) {
      btn.disabled = true;
      btn.dataset.tooltip = localizeHealReason(reason);
      continue;
    }

    btn.dataset.tooltip = game.i18n.localize("ARKHAM_HORROR.HEALING.Tooltip");

    if (btn.dataset.arkhamHealBound === "1") continue;
    btn.dataset.arkhamHealBound = "1";

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await startApplyHealing({
        flags,
        tokenUuid: String(btn.dataset.targetUuid ?? ""),
        actorUuid: String(btn.dataset.actorUuid ?? ""),
        targetName,
        successes,
        succeeded,
      });
    });
  }
}

function decorateReactionBacklink(message, html) {
  const flags = message?.flags?.[SYSTEM_ID];
  if (!flags?.respondsTo) return;

  const card = html?.querySelector?.(".arkham-roll-card");
  if (!card || card.querySelector(".arkham-defend-backlink")) return;

  const banner = document.createElement("div");
  banner.className = "arkham-defend-backlink";
  banner.dataset.messageId = String(flags.respondsTo);
  banner.textContent = game.i18n.format("ARKHAM_HORROR.DEFEND.ReactionTo", {
    attacker: String(flags.defendAttackerName ?? ""),
  });
  card.prepend(banner);
}

// The defending client usually cannot update the attack card, so every card that
// belongs to the same attack (original plus reroll cards) is re-rendered by hand
// once the reaction card arrives.
function refreshAttackCards(message) {
  const attackId = message?.flags?.[SYSTEM_ID]?.respondsTo;
  if (!attackId) return;

  for (const candidate of game.messages ?? []) {
    const flags = candidate?.flags?.[SYSTEM_ID];
    if (!flags?.showDefendSection) continue;
    if (resolveAttackRootMessage(candidate)?.id !== attackId) continue;
    ui.chat?.updateMessage?.(candidate);
  }
}

export function registerChatDefendHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    decorateReactionBacklink(message, html);
    decorateDefendSection(message, html);
    decorateHealSection(message, html);
  });

  Hooks.on("createChatMessage", refreshAttackCards);
  Hooks.on("updateChatMessage", refreshAttackCards);
}
