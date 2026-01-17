// Functional implementation of helper functions for use by class based roll workflows see SkillWorkflow.mjs, etc.
// Allows for composable roll pipelines to be developed.

// Dice So Nice support integration
export function addShowDicePromise(promises, roll) {
  if (game.dice3d) {
    // synchronize=true so DSN dice appear on all players' screens
    promises.push(game.dice3d.showForRoll(roll, game.user, true, null, false));
  }
}

// Core D6 rolling function
// if rolling separately for horror dice, pass in dicePromises to collect all show dice promises together, see implementation in execute() in skill-roll-workflow.mjs
export async function rollD6({ actor, numDice, dicePromises } = {}) {
  const roll = new Roll(`${numDice}d6`, actor.getRollData());
  await roll.evaluate();

  // Render immediately (old app rendered before awaiting DSN)
  const html = await roll.render();
  const results = roll.terms[0].results.map(r => r.result);

  if (dicePromises) {
    addShowDicePromise(dicePromises, roll);
  } else {
    const promises = [];
    addShowDicePromise(promises, roll);
    await Promise.all(promises);
  }

  return { roll, html, results };
}

// Computes dice pools + success threshold exactly like original logic from 13.0.7 ALPHA dice-roll-app.
export function calculatePoolsAndThresholds({
  actor,
  skillCurrent,
  currentDicePool,
  diceToUse,
  penalty,
  bonusDice,
  resultModifier,
  rollWithAdvantage,
  rollWithDisadvantage,
}) {
  const skillCurrentNum = Number.parseInt(skillCurrent) || 0;
  const currentDicePoolNum = Number.parseInt(currentDicePool) || 0;
  const diceToUseNum = Number.parseInt(diceToUse) || 0;
  const numHorrorDice = Number.parseInt(actor.system.horror) || 0;

  let successOn = skillCurrentNum;
  let diceToRoll = diceToUseNum;
  let horrorDiceToRoll = 0;

  if (numHorrorDice >= currentDicePoolNum) {
    horrorDiceToRoll = diceToUseNum;
    diceToRoll = 0;
  } else {
    const normalDice = currentDicePoolNum - numHorrorDice;
    if (normalDice >= diceToUseNum) {
      diceToRoll = diceToUseNum;
    } else {
      horrorDiceToRoll = diceToUseNum - normalDice;
      diceToRoll = normalDice;
    }
  }

  const b = Number.parseInt(bonusDice) || 0;
  diceToRoll += b;

  const p = Number.parseInt(penalty) || 0;
  const rm = Number.parseInt(resultModifier) || 0;
  // Removing this because I believe it is double counting penalties for the purposes of # success calculation, 
  // while the die results will match the correct penalty the success count logic already accounts for that and doesn't need to be raised.
  // if (p > 0) {
  //   successOn = Math.min(6, successOn + p);
  // }

  if (rollWithAdvantage) diceToRoll += 1;
  if (rollWithDisadvantage && diceToRoll > 0) diceToRoll += 1;

  return {
    successOn,
    diceToUse: diceToUseNum,
    diceToRoll,
    horrorDiceToRoll,
    penalty: p,
    bonusDice: b,
    resultModifier: rm,
    rollWithAdvantage: !!rollWithAdvantage,
    rollWithDisadvantage: !!rollWithDisadvantage,
  };
}

// Combines normal + horror results into per-die objects.
// rawResult is the natural d6 face (1-6). result is the displayed/modified face.
export function collectTaggedResults({ normalResults, horrorResults = [] }) {
  const tagged = [];

  const pushDie = ({ rawResult, isHorror }) => {
    const raw = Number(rawResult) || 0;
    tagged.push({
      rawResult: raw,
      result: raw, // modifiers apply later
      isHorror: !!isHorror,
      isDropped: false,
      isNat1: raw === 1,
      isNat6: raw === 6,
    });
  };

  normalResults.forEach(r => pushDie({ rawResult: r, isHorror: false }));
  horrorResults.forEach(r => pushDie({ rawResult: r, isHorror: true }));
  return tagged;
}

// Marks highest or lowest die as dropped based on advantage/disadvantage flags.
// The die remains in the array (so it can be displayed and/or referenced for rerolls).
export function applyAdvantageDisadvantageDrop(diceRollResults, { rollWithAdvantage, rollWithDisadvantage }) {
  const pickIndex = ({ mode }) => {
    const candidates = diceRollResults
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => !d.isDropped);
    if (candidates.length === 0) return -1;

    const values = candidates.map(({ d }) => Number(d.rawResult ?? d.result) || 0);
    const target = mode === "min" ? Math.min(...values) : Math.max(...values);
    const picked = candidates.find(({ d }) => (Number(d.rawResult ?? d.result) || 0) === target);
    return picked ? picked.i : -1;
  };

  if (rollWithAdvantage) {
    const idx = pickIndex({ mode: "min" });
    if (idx >= 0) diceRollResults[idx].isDropped = true;
  }

  if (rollWithDisadvantage) {
    const idx = pickIndex({ mode: "max" });
    if (idx >= 0) diceRollResults[idx].isDropped = true;
  }
}

// Computes final success/failure counts based on modified dice results like original logic from 13.0.7 ALPHA dice-roll-app.
export function computeSkillOutcome(diceRollResults, { successOn, penalty, successesNeeded, resultModifier }) {
  const kept = diceRollResults.filter(r => !r.isDropped);

  // count all natural 6s as successes
  let successCount = kept.filter(r => (r.rawResult ?? r.result) === 6).length;

  // failures (natural 1s)
  let failureCount = kept.filter(r => (r.rawResult ?? r.result) === 1 && !r.isHorror).length;
  const horrorFailureCount = kept.filter(r => (r.rawResult ?? r.result) === 1 && r.isHorror).length;

  const so = Number.parseInt(successOn) || 0;
  const p = Number.parseInt(penalty) || 0;
  const rm = Number.parseInt(resultModifier) || 0;

  // Compute displayed result for every die (including dropped), but only count kept dice.
  const withDisplayed = diceRollResults.map(r => {
    const raw = Number(r.rawResult ?? r.result) || 0;
    const isNat1 = raw === 1;
    const isNat6 = raw === 6;
    const displayed = (isNat1 || isNat6)
      ? raw
      : Math.min(6, Math.max(1, (raw - p) + rm));

    return {
      ...r,
      rawResult: raw,
      result: displayed,
      isNat1,
      isNat6,
    };
  });

  const keptDisplayed = withDisplayed.filter(r => !r.isDropped);
  const nonNat = keptDisplayed.filter(r => !r.isNat1 && !r.isNat6);

  // check success threshold on modified dice now
  successCount += nonNat.filter(r => r.result >= so).length;
  // count failures on non-natural dice
  failureCount += nonNat.filter(r => r.result < so).length;

  const needed = Number.parseInt(successesNeeded) || 0;
  const isSuccess = successCount >= needed;

  return {
    isSuccess,
    successCount,
    failureCount,
    horrorFailureCount,
    finalDiceRollResults: withDisplayed,
  };
}

// Deducts rolled dice from actor pool.
export async function applyDicepoolCost(actor, diceToUse) {
  const oldDicePoolValue = actor.system.dicepool.value;
  const newDicePoolValue = Math.max(0, oldDicePoolValue - diceToUse);
  await actor.update({ "system.dicepool.value": newDicePoolValue });
  return { oldDicePoolValue, newDicePoolValue };
}