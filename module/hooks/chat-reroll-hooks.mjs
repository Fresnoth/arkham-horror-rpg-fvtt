import { RerollDiceApp } from "../apps/reroll-dice-app.mjs";
import { SkillRerollWorkflow } from "../rolls/skill-reroll-workflow.mjs";

const SYSTEM_ID = "arkham-horror-rpg-fvtt";

function resolveActorFromMessage(message) {
  try {
    const a = ChatMessage.getSpeakerActor?.(message?.speaker);
    if (a) return a;
  } catch (e) {
    // ignore
  }
  const actorId = message?.speaker?.actor;
  return actorId ? game.actors.get(actorId) : null;
}

function canUserReroll({ actor }) {
  if (game.user?.isGM) return true;
  return !!actor?.isOwner;
}

export function registerChatRerollHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const rollFlags = message?.flags?.[SYSTEM_ID];
    if (!rollFlags || rollFlags.rollCategory !== "skill") return;

    const actor = resolveActorFromMessage(message);
    const allowed = canUserReroll({ actor });

    // Reroll button
    const btn = html?.querySelector?.('[data-action="arkham-reroll"]');
    if (btn) {
      if (!allowed) {
        btn.style.display = "none";
      } else {
        if (btn.dataset.arkhamRerollBound === "1") return;
        btn.dataset.arkhamRerollBound = "1";

        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const app = RerollDiceApp.getInstance({
            actor,
            message,
            rollFlags,
            onConfirm: async ({ selectedIndices }) => {
              try {
                const workflow = SkillRerollWorkflow.fromMessage({ message, actor, selectedIndices });
                await workflow.run();
              } catch (e) {
                ui.notifications.warn(String(e?.message ?? e));
              }
            },
          });
          app.render(true);
        });
      }
    }
  });
}
