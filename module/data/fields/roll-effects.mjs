// Shared definition of `system.rollEffects` and `system.usage`.
//
// Both shapes used to be copied into `item-knack.mjs` and `item-injury.mjs`, and the copies had
// already drifted: knacks carry the dice modifiers, injuries only a penalty. That difference is
// kept here as an explicit preset instead of a fork, so a new item type only picks a preset.
//
// Example — a First Aid Kit (core p. 90) as a `useful_item`, which adds one success to a healing
// roll and burns a charge doing so:
//   system.rollEffects = {
//     enabled: true,
//     skillKeys: ["knowledge"],
//     rollKinds: ["heal-damage"],
//     modifier: { addSuccesses: 1 }
//   }
//   system.usage = { frequency: "unlimited", max: 3, remaining: 3, decreaseAfterUsage: true }

import { HEAL_ROLL_KINDS } from "../../helpers/healing.mjs";

/** Skill keys an effect can be restricted to; `any` matches every skill. */
export const ROLL_EFFECT_SKILL_KEYS = Object.freeze([
  "any",
  "agility",
  "athletics",
  "wits",
  "presence",
  "intuition",
  "knowledge",
  "resolve",
  "meleeCombat",
  "rangedCombat",
  "lore",
]);

/**
 * Roll kinds as used by `DiceRollApp.rollState.rollKind`. The healing kinds are imported rather
 * than repeated so `helpers/healing.mjs` stays the single source for their names.
 */
export const ROLL_EFFECT_ROLL_KINDS = Object.freeze([
  "any",
  "complex",
  "reaction",
  "tome-understand",
  "tome-attune",
  ...HEAL_ROLL_KINDS,
]);

/** Item types whose `rollEffects` the dice dialog offers for selection (see `helpers/knacks.mjs`). */
export const ROLL_EFFECT_ITEM_TYPES = Object.freeze(["knack", "useful_item", "relic"]);

export const USAGE_FREQUENCIES = Object.freeze([
  "passive",
  "oncePerTurn",
  "oncePerScene",
  "oncePerSession",
  "unlimited",
]);

/**
 * Which modifier fields an item type gets. Existing worlds keep validating because every field is
 * optional-by-initial: a stored knack simply has no `penalty` key, a stored injury none of the
 * dice modifiers.
 */
export const ROLL_EFFECT_MODIFIERS = Object.freeze({
  /** Items the player chooses to use: knacks, useful items, relics. */
  active: Object.freeze([
    "addBonusDice",
    "resultModifier",
    "advantage",
    "disadvantage",
    "rerollAllowanceDice",
    "addSuccesses",
    "healDamage",
    "healInjury",
    "reduceHorrorLimit",
  ]),

  /** Injuries only ever subtract, applied automatically (see `helpers/injuries.mjs`). */
  penalty: Object.freeze(["penalty"]),
});

/**
 * i18n key per roll kind. The healing kinds reuse the labels of `HEALING.RollKind`, which the heal
 * dialog already shows — one wording for the same thing in both places.
 */
export const ROLL_KIND_LABELS = Object.freeze({
  any: "ARKHAM_HORROR.KNACK_SHEET.RollKind.Any",
  complex: "ARKHAM_HORROR.KNACK_SHEET.RollKind.Complex",
  reaction: "ARKHAM_HORROR.KNACK_SHEET.RollKind.Reaction",
  "tome-understand": "ARKHAM_HORROR.KNACK_SHEET.RollKind.TomeUnderstand",
  "tome-attune": "ARKHAM_HORROR.KNACK_SHEET.RollKind.TomeAttune",
  "heal-damage": "ARKHAM_HORROR.HEALING.RollKind.heal-damage",
  "heal-injury": "ARKHAM_HORROR.HEALING.RollKind.heal-injury",
  introspection: "ARKHAM_HORROR.HEALING.RollKind.introspection",
  counseling: "ARKHAM_HORROR.HEALING.RollKind.counseling",
});

/**
 * How each modifier is edited on an item sheet. `type` decides the input, `label`/`hint` the i18n
 * keys. Kept next to the schema so a new modifier cannot be added without also deciding how it is
 * entered — the sheets read this table instead of listing fields by hand.
 */
export const ROLL_EFFECT_MODIFIER_META = Object.freeze({
  addBonusDice: { type: "number", min: 0, label: "ARKHAM_HORROR.KNACK_SHEET.BonusDiceDelta" },
  resultModifier: { type: "number", label: "ARKHAM_HORROR.KNACK_SHEET.ResultModifierDelta" },
  advantage: { type: "boolean", label: "ARKHAM_HORROR.PROPS.Advantage" },
  disadvantage: { type: "boolean", label: "ARKHAM_HORROR.PROPS.Disadvantage" },
  rerollAllowanceDice: { type: "number", min: 0, label: "ARKHAM_HORROR.KNACK_SHEET.RerollAllowanceDice" },

  addSuccesses: {
    type: "number",
    min: 0,
    label: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.AddSuccesses",
    hint: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.AddSuccessesHint",
  },
  healDamage: {
    type: "number",
    min: 0,
    label: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.HealDamage",
    hint: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.HealDamageHint",
  },
  healInjury: {
    type: "boolean",
    label: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.HealInjury",
    hint: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.HealInjuryHint",
  },
  reduceHorrorLimit: {
    type: "number",
    min: 0,
    label: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.ReduceHorrorLimit",
    hint: "ARKHAM_HORROR.ROLL_EFFECT_SHEET.ReduceHorrorLimitHint",
  },

  penalty: {
    type: "number",
    min: 0,
    label: "ARKHAM_HORROR.INJURY_SHEET.PenaltyPerDie",
    hint: "ARKHAM_HORROR.INJURY_SHEET.PenaltyHint",
  },
});

function localize(key, fallback = "") {
  const i18n = globalThis.game?.i18n;
  if (!i18n?.localize) return fallback || key;
  return i18n.localize(key);
}

function skillLabel(key) {
  if (key === "any") return localize("ARKHAM_HORROR.KNACK_SHEET.Any", "Any");
  return localize(`ARKHAM_HORROR.SKILL.${key}`, key);
}

function rollKindLabel(key) {
  return localize(ROLL_KIND_LABELS[key] ?? key, key);
}

/**
 * Everything an item sheet needs to render a `rollEffects` editor: the two pick lists, the pills of
 * what is already selected, and one entry per modifier the given item type actually has.
 *
 * Which modifiers exist is read off the stored data rather than from the item type, so an item type
 * that later switches presets needs no change here.
 *
 * @param {object} rollEffects The item's `system.rollEffects`.
 * @returns {{enabled: boolean, skillChoices: object[], rollKindChoices: object[],
 *   selectedSkills: object[], selectedRollKinds: object[], modifiers: object[]}}
 */
export function buildRollEffectContext(rollEffects = {}) {
  const skillKeys = (Array.isArray(rollEffects.skillKeys) ? rollEffects.skillKeys : ["any"]).map(String);
  const rollKinds = (Array.isArray(rollEffects.rollKinds) ? rollEffects.rollKinds : ["any"]).map(String);
  const modifier = rollEffects.modifier ?? {};

  const modifiers = [];
  for (const key of Object.keys(ROLL_EFFECT_MODIFIER_META)) {
    if (!(key in modifier)) continue;
    const meta = ROLL_EFFECT_MODIFIER_META[key];
    modifiers.push({
      key,
      name: `system.rollEffects.modifier.${key}`,
      label: localize(meta.label, key),
      hint: meta.hint ? localize(meta.hint) : "",
      isBoolean: meta.type === "boolean",
      isNumber: meta.type !== "boolean",
      hasMin: Number.isFinite(meta.min),
      min: meta.min ?? 0,
      value: modifier[key],
      checked: !!modifier[key],
    });
  }

  return {
    enabled: !!rollEffects.enabled,
    skillChoices: ROLL_EFFECT_SKILL_KEYS.map(key => ({ key, label: skillLabel(key) })),
    rollKindChoices: ROLL_EFFECT_ROLL_KINDS.map(key => ({ key, label: rollKindLabel(key) })),
    selectedSkills: skillKeys.map(key => ({ key, label: skillLabel(key) })),
    selectedRollKinds: rollKinds.map(key => ({ key, label: rollKindLabel(key) })),
    modifiers,
  };
}

/**
 * The usage editor's dropdown, with the stored value pre-selected.
 * @param {object} usage The item's `system.usage`.
 */
export function buildUsageContext(usage = {}) {
  const current = String(usage.frequency ?? "passive");
  return {
    frequencies: USAGE_FREQUENCIES.map(key => ({
      key,
      label: localize(`ARKHAM_HORROR.KNACK_USAGE.${key}`, key),
      selected: key === current,
    })),
  };
}

function buildModifierFields(keys) {
  const fields = foundry.data.fields;
  const requiredInteger = { required: true, nullable: false, integer: true };

  const builders = {
    addBonusDice: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    resultModifier: () => new fields.NumberField({ ...requiredInteger, initial: 0 }),
    advantage: () => new fields.BooleanField({ required: true, nullable: false, initial: false }),
    disadvantage: () => new fields.BooleanField({ required: true, nullable: false, initial: false }),

    // For reroll-style effects this is an allowance recorded on the roll result.
    // Enforcement is intentionally deferred.
    rerollAllowanceDice: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),

    // Per-die face reduction handled by the roll engine.
    penalty: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),

    // Raises the counted successes after the dice have been evaluated (`computeSkillOutcome`).
    addSuccesses: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),

    // The following three never change a roll. They are carried through the roll result into the
    // chat flags so the apply dialogs can offer them (core p. 33-34 and p. 38).
    healDamage: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    healInjury: () => new fields.BooleanField({ required: true, nullable: false, initial: false }),
    reduceHorrorLimit: () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
  };

  const schema = {};
  for (const key of keys) {
    const build = builders[key];
    if (build) schema[key] = build();
  }
  return schema;
}

/**
 * The `system.rollEffects` schema field.
 * @param {object} [options]
 * @param {string[]} [options.modifiers] One of the `ROLL_EFFECT_MODIFIERS` presets.
 */
export function rollEffectsField({ modifiers = ROLL_EFFECT_MODIFIERS.active } = {}) {
  const fields = foundry.data.fields;

  return new fields.SchemaField({
    enabled: new fields.BooleanField({ required: true, nullable: false, initial: false }),

    // Skill keys (prefer using existing actor system keys to avoid mapping bugs).
    skillKeys: new fields.ArrayField(
      new fields.StringField({
        required: true,
        nullable: false,
        choices: [...ROLL_EFFECT_SKILL_KEYS],
      }),
      { initial: ["any"] }
    ),

    rollKinds: new fields.ArrayField(
      new fields.StringField({
        required: true,
        nullable: false,
        choices: [...ROLL_EFFECT_ROLL_KINDS],
      }),
      { initial: ["any"] }
    ),

    modifier: new fields.SchemaField(buildModifierFields(modifiers)),
  });
}

/**
 * The `system.usage` schema field. Usage tracking is stored, but reset automation is intentionally
 * manual in v1.
 */
export function usageField() {
  const fields = foundry.data.fields;
  const requiredInteger = { required: true, nullable: false, integer: true, min: 0 };

  return new fields.SchemaField({
    frequency: new fields.StringField({
      required: true,
      nullable: false,
      initial: "passive",
      choices: [...USAGE_FREQUENCIES],
    }),

    max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    remaining: new fields.NumberField({ ...requiredInteger, initial: 0 }),

    // Follows `weapon.system.ammunition.decreaseAfterUsage`: a use burns a charge even when the
    // frequency itself does not limit anything. Off by default, so every knack that exists today
    // keeps being governed by `frequency` alone.
    decreaseAfterUsage: new fields.BooleanField({ required: true, nullable: false, initial: false }),
  });
}
