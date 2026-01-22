/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  const load = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  return load([
    // Actor partials.
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/actor-features.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/actor-items.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/actor-spells.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/actor-effects.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/_skill.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-knacks.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-insight.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-dicepool.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-personality-trait.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-injuries.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/npc/parts/_skill.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/shared/_skill_options.hbs',
    // Chat cards
    'systems/arkham-horror-rpg-fvtt/templates/chat/insight-update.hbs',
    'systems/arkham-horror-rpg-fvtt/templates/chat/money-update.hbs',
    // Apps
    'systems/arkham-horror-rpg-fvtt/templates/money-adjust-app/dialog.hbs',
    // Item partials
    'systems/arkham-horror-rpg-fvtt/templates/item/parts/item-effects.hbs',
  ]);
};
