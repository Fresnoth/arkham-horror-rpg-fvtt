import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorKnack extends ArkhamHorrorItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    const requiredInteger = { required: true, nullable: false, integer: true };

    const DocumentUUIDField = fields.DocumentUUIDField ?? fields.StringField;
    
    schema.tier = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Usage tracking is stored, but reset automation is intentionally manual in v1.
    schema.usage = new fields.SchemaField({
      frequency: new fields.StringField({
        required: true,
        nullable: false,
        initial: "passive",
        choices: ["passive", "oncePerTurn", "oncePerScene", "oncePerSession", "unlimited"],
      }),

      max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      remaining: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
    });

    // Roll effects are prompt-selectable only in v1.
    schema.rollEffects = new fields.SchemaField({
      enabled: new fields.BooleanField({ required: true, nullable: false, initial: false }),

      // Skill keys (prefer using existing actor system keys to avoid mapping bugs).
      skillKeys: new fields.ArrayField(
        new fields.StringField({
          required: true,
          nullable: false,
          choices: [
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
          ],
        }),
        { initial: ["any"] }
      ),

      // Roll kinds as used by DiceRollApp.rollState.rollKind.
      rollKinds: new fields.ArrayField(
        new fields.StringField({
          required: true,
          nullable: false,
          choices: ["any", "complex", "reaction", "tome-understand", "tome-attune"],
        }),
        { initial: ["any"] }
      ),

      modifier: new fields.SchemaField({
        addBonusDice: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        resultModifier: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        advantage: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        disadvantage: new fields.BooleanField({ required: true, nullable: false, initial: false }),

        // For reroll-style knacks, this is an allowance recorded on the roll result.
        // Enforcement is intentionally deferred.
        rerollAllowanceDice: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      }),
    });

    // Grants: primarily spell UUID references. These are applied immediately when the knack is acquired.
    // We store structured grant entries to allow future expansion beyond spells.
    schema.grants = new fields.ArrayField(
      new fields.SchemaField({
        type: new fields.StringField({ required: true, nullable: false, initial: "spell", choices: ["spell"] }),
        uuid: new DocumentUUIDField({ required: true, nullable: false, blank: false }),
      }),
      { initial: [] }
    );

    return schema;
  }
}