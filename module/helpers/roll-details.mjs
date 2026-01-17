const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function computeShowRollDetails(data = {}) {
  return Boolean(
    data.rollWithAdvantage ||
      data.rollWithDisadvantage ||
      toNumber(data.bonusDice) >= 1 ||
      toNumber(data.penalty) >= 1 ||
      toNumber(data.resultModifier) >= 1
  );
}
