function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDicepoolResourceBounds(actor, { currentDicePool } = {}) {
  const poolValue = Math.max(
    0,
    currentDicePool === undefined
      ? asInt(actor?.system?.dicepool?.value, 0)
      : asInt(currentDicePool, 0),
  );

  const horrorLimit = Math.max(0, asInt(actor?.system?.horror, 0));
  const storedHorrorInPool = asInt(actor?.system?.dicepool?.horrorInPool, Number.NaN);
  const availableHorror = Number.isFinite(storedHorrorInPool)
    ? Math.max(0, Math.min(storedHorrorInPool, poolValue, horrorLimit))
    : Math.min(horrorLimit, poolValue);
  const availableRegular = Math.max(0, poolValue - availableHorror);

  return {
    currentDicePool: poolValue,
    horrorLimit,
    availableHorror,
    availableRegular,
  };
}

export function getHorrorSpendBounds(actor, {
  currentDicePool,
  diceToUse,
  horrorDiceToUse,
} = {}) {
  const resourceBounds = getDicepoolResourceBounds(actor, { currentDicePool });
  const selectedDiceToUse = Math.max(0, asInt(diceToUse, 0));
  const minHorrorDiceToUse = Math.max(0, selectedDiceToUse - resourceBounds.availableRegular);
  const maxHorrorDiceToUse = Math.min(resourceBounds.availableHorror, selectedDiceToUse);
  const clampedHorrorMin = Math.min(minHorrorDiceToUse, maxHorrorDiceToUse);
  const clampedHorrorDiceToUse = Math.max(
    clampedHorrorMin,
    Math.min(maxHorrorDiceToUse, asInt(horrorDiceToUse, 0)),
  );

  return {
    ...resourceBounds,
    selectedDiceToUse,
    minHorrorDiceToUse,
    maxHorrorDiceToUse,
    clampedHorrorDiceToUse,
  };
}