import { createArkhamHorrorChatCard } from "../util/chat-utils.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";
const TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/dicepool-reset.hbs`;

export async function refreshDicepoolAndPost({ actor, label = "Dicepool Refresh", healDamage = false } = {}) {
  if (!actor) throw new Error("refreshDicepoolAndPost requires an actor");

  const oldDamage = Number(actor.system?.damage ?? 0);
  const oldDicePoolValue = Number(actor.system?.dicepool?.value ?? 0);
  const dicePoolMax = Number(actor.system?.dicepool?.max ?? 0);

  const newDamage = healDamage ? 0 : oldDamage;
  const newDicePoolValue = Math.max(0, dicePoolMax - newDamage);

  const updateData = {
    "system.dicepool.value": newDicePoolValue,
  };
  if (healDamage && oldDamage !== 0) updateData["system.damage"] = 0;

  await actor.update(updateData);

  const healedDamage = Math.max(0, oldDamage - newDamage);

  const chatVars = {
    label,
    actorName: actor.name,
    oldDicePoolValue,
    newDicePoolValue,
    healedDamage,
  };

  const flags = {
    [SYSTEM_ID]: {
      ...chatVars,
      rollCategory: "dicepool",
    },
  };

  await createArkhamHorrorChatCard({ actor, template: TEMPLATE, chatVars, flags });

  return {
    oldDamage,
    newDamage,
    healedDamage,
    oldDicePoolValue,
    newDicePoolValue,
  };
}
