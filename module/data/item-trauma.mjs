import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorTrauma extends ArkhamHorrorItemBase {

    static defineSchema() {
        const fields = foundry.data.fields;
        const schema = super.defineSchema();

        return schema;
    }
}