import ArkhamHorrorItemBase from "./base-item.mjs";
import { rollEffectsField, usageField } from "./fields/roll-effects.mjs";

export default class ArkhamHorrorUsefulItem extends ArkhamHorrorItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // Controls whether this Useful Item should be treated as having Special Rules (default true for backwards compatibility).
    schema.hasSpecialRules = new fields.BooleanField({ required: true, nullable: false, initial: true });

    schema.specialRules = new fields.StringField({ required: true, blank: true });
    schema.cost = new fields.NumberField({ required: true, nullable: false, integer: false, initial: 0, min: 0 });

    // LEGACY. `uses` predates `usage` and used to be the counter shown on the sheets. `usage` is now
    // the single source for charges everywhere; `uses` is only still read to seed it (see
    // `prepareDerivedData`) and is no longer written by any sheet. It stays in the schema until the
    // world migration removes it, so nothing is lost in the meantime.
    schema.uses = new fields.SchemaField({
      max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      current: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
    });

    schema.usage = usageField();
    schema.rollEffects = rollEffectsField();

    return schema;
  }

  /**
   * Seeds `usage` from the legacy `uses` counter so items stored before the merge keep showing their
   * charges. Derived only: nothing is written until the owner edits the item, which keeps this a
   * display-level change and leaves the actual data untouched for the later migration.
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();

    const legacyMax = Number(this.uses?.max ?? 0) || 0;
    if (legacyMax <= 0) return;
    if ((Number(this.usage?.max ?? 0) || 0) > 0) return;

    this.usage.max = legacyMax;
    this.usage.remaining = Math.min(legacyMax, Math.max(0, Number(this.uses?.current ?? 0) || 0));

    // Without this the seeded counter would sit there and never move: `frequency` alone does not
    // spend charges (see `usageField`).
    this.usage.decreaseAfterUsage = true;
  }
}
