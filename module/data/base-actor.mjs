import ArkhamHorrorDataModel from "./base-model.mjs";

export default class ArkhamHorrorActorBase extends ArkhamHorrorDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    const DocumentUUIDField = fields.DocumentUUIDField ?? fields.StringField;

    schema.dicepool = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 6 }),
      horrorInPool: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })
    });

    schema.damage = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.horror = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.archetype = new fields.StringField({ required: true, blank: true });
    schema.archetypeUuid = new DocumentUUIDField({ required: false, nullable: true });

     schema.skills = new fields.SchemaField({
      agility: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      athletics: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      wits: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      presence: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      intuition: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      knowledge: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      resolve: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      meleeCombat: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      rangedCombat: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
      lore: new fields.SchemaField({
        current: new fields.NumberField({ ...requiredInteger, initial: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0 })
      }),
    });

    schema.biography = new fields.StringField({ required: true, blank: true }); // equivalent to passing ({initial: ""}) for StringFields

    return schema;
  }

    prepareDerivedData() {
    this.dicepoolPrepared = [];
    const presentDicePoolMax = Math.max(0, this.dicepool.max - this.damage);

    // dice pool value is max presentDicepool max
    this.dicepool.value = Math.min(this.dicepool.value,presentDicePoolMax);

    const horrorLimit = Math.max(0, Number(this.horror) || 0);
    const rawHorrorInPool = this.dicepool.horrorInPool;
    const storedHorrorInPool = (rawHorrorInPool === null || rawHorrorInPool === undefined)
      ? Number.NaN
      : Number(rawHorrorInPool);
    const hasStoredHorrorInPool = Number.isFinite(storedHorrorInPool);
    const fallbackHorrorInPool = Math.min(horrorLimit, this.dicepool.value);
    const effectiveHorrorInPool = hasStoredHorrorInPool ? storedHorrorInPool : fallbackHorrorInPool;

    this.dicepool.horrorInPool = Math.max(0, Math.min(effectiveHorrorInPool, this.dicepool.value, horrorLimit));

    const horrorSlots = Math.min(horrorLimit, presentDicePoolMax);
    const activeHorrorDice = Math.max(0, Math.min(this.dicepool.horrorInPool, this.dicepool.value));
    const spentHorrorDice = Math.max(0, horrorSlots - activeHorrorDice);

    for (let i = 1; i <= presentDicePoolMax; i++) {
      const used = i > this.dicepool.value;
      let isHorrorDice = false;

      if (!used) {
        // Active dice reflect actual in-pool composition.
        isHorrorDice = i <= activeHorrorDice;
      } else {
        // Used dice reflect what has been spent from horror capacity first.
        const usedIndex = i - this.dicepool.value;
        isHorrorDice = usedIndex <= spentHorrorDice;
      }

      this.dicepoolPrepared.push({ index: i, max: presentDicePoolMax, used, isHorrorDice });
    }
  }
}