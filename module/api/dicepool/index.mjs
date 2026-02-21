import { refreshDicepoolAndPost } from "../../helpers/dicepool.mjs";
import { openInjuryTraumaDialog } from "../rolls/index.mjs";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function snapshot(actor) {
  const value = Math.max(0, toNumber(actor?.system?.dicepool?.value, 0));
  const max = Math.max(0, toNumber(actor?.system?.dicepool?.max, 0));
  const damage = Math.max(0, toNumber(actor?.system?.damage, 0));
  const horror = Math.max(0, toNumber(actor?.system?.horror, 0));
  const rawHorrorInPool = actor?.system?.dicepool?.horrorInPool;
  const storedHorrorInPool = (rawHorrorInPool === null || rawHorrorInPool === undefined)
    ? Number.NaN
    : toNumber(rawHorrorInPool, Number.NaN);
  const fallbackHorrorInPool = Math.min(horror, value);
  const horrorInPool = Number.isFinite(storedHorrorInPool)
    ? Math.max(0, Math.min(storedHorrorInPool, value, horror))
    : fallbackHorrorInPool;
  return { value, max, damage, horror, horrorInPool };
}

function resolveHorrorInPoolAfterValueChange(state, nextValue) {
  const next = Math.max(0, toNumber(nextValue, 0));
  const prevValue = Math.max(0, toNumber(state?.value, 0));
  const prevHorrorInPool = Math.max(0, toNumber(state?.horrorInPool, 0));
  const horrorLimit = Math.max(0, toNumber(state?.horror, 0));
  const maxHorrorAtNext = Math.min(horrorLimit, next);

  // On decreases, preserve composition as much as possible and clamp.
  if (next <= prevValue) {
    return Math.max(0, Math.min(prevHorrorInPool, maxHorrorAtNext));
  }

  // On increases, refill horror first before regular dice.
  const addedDice = next - prevValue;
  const missingHorror = Math.max(0, maxHorrorAtNext - prevHorrorInPool);
  const horrorGained = Math.min(addedDice, missingHorror);
  return Math.max(0, Math.min(prevHorrorInPool + horrorGained, maxHorrorAtNext));
}

export async function adjustDamage(actor, {
  delta,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const state = snapshot(actor);
  const step = Number.parseInt(delta) || 0;
  const next = Math.min(state.max, Math.max(0, state.damage + step));

  await actor.update({ "system.damage": next });
  return { ok: true, reason: null, oldDamage: state.damage, newDamage: next };
}

export async function adjustHorror(actor, {
  delta,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const state = snapshot(actor);
  const step = Number.parseInt(delta) || 0;
  const next = Math.min(state.max, Math.max(0, state.horror + step));
  const nextHorrorInPool = Math.max(0, Math.min(state.horrorInPool, next, state.value));

  await actor.update({
    "system.horror": next,
    "system.dicepool.horrorInPool": nextHorrorInPool,
  });

  return {
    ok: true,
    reason: null,
    oldHorror: state.horror,
    newHorror: next,
    oldHorrorInPool: state.horrorInPool,
    newHorrorInPool: nextHorrorInPool,
  };
}

export async function adjustValue(actor, {
  delta,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const state = snapshot(actor);
  const step = Number.parseInt(delta) || 0;
  const effectiveMax = Math.max(0, state.max - state.damage);
  const next = Math.min(effectiveMax, Math.max(0, state.value + step));
  const nextHorrorInPool = resolveHorrorInPoolAfterValueChange(state, next);

  await actor.update({
    "system.dicepool.value": next,
    "system.dicepool.horrorInPool": nextHorrorInPool,
  });

  return {
    ok: true,
    reason: null,
    oldValue: state.value,
    newValue: next,
    oldHorrorInPool: state.horrorInPool,
    newHorrorInPool: nextHorrorInPool,
  };
}

export async function setValue(actor, {
  value,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const state = snapshot(actor);
  const requested = Math.max(0, Number.parseInt(value) || 0);
  const effectiveMax = Math.max(0, state.max - state.damage);
  const next = Math.min(effectiveMax, requested);
  const nextHorrorInPool = resolveHorrorInPoolAfterValueChange(state, next);

  await actor.update({
    "system.dicepool.value": next,
    "system.dicepool.horrorInPool": nextHorrorInPool,
  });

  return {
    ok: true,
    reason: null,
    oldValue: state.value,
    newValue: next,
    oldHorrorInPool: state.horrorInPool,
    newHorrorInPool: nextHorrorInPool,
  };
}

export async function refresh(actor, {
  label = game.i18n.localize("ARKHAM_HORROR.DICEPOOL.Chat.Refresh"),
  healDamage = false,
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  const result = await refreshDicepoolAndPost({
    actor,
    label,
    healDamage,
  });

  return {
    ok: true,
    reason: null,
    ...result,
  };
}

export async function strain(actor, {
  source = "api",
} = {}) {
  if (!actor) return { ok: false, reason: "ACTOR_REQUIRED" };

  if (!actor?.isOwner) {
    ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.Warnings.PermissionStrainActor"));
    return { ok: false, reason: "PERMISSION_DENIED" };
  }

  const currentDamage = Number(actor.system?.damage ?? 0) || 0;
  if (currentDamage <= 0) {
    ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.Warnings.StrainRequiresDamage"));
    return { ok: false, reason: "NO_DAMAGE_TO_STRAIN" };
  }

  const refreshResult = await refreshDicepoolAndPost({
    actor,
    label: game.i18n.localize("ARKHAM_HORROR.ACTIONS.StrainOneself"),
    healDamage: true,
  });

  const injuryResult = await openInjuryTraumaDialog(actor, {
    rollKind: "injury",
    rollSource: "strain",
  });

  return {
    ok: true,
    reason: null,
    source,
    refresh: refreshResult,
    injury: injuryResult,
  };
}

export const dicepoolApi = {
  version: "v1",
  adjustDamage,
  adjustHorror,
  adjustValue,
  setValue,
  refresh,
  strain,
};
