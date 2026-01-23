export function setupConfiguration() {
    game.settings.register("arkham-horror-rpg-fvtt", "tokenShowDicePools", {
        name: "ARKHAM_HORROR.Settings.TokenShowDicePools.Name",
        hint: "ARKHAM_HORROR.Settings.TokenShowDicePools.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "tokenShowDamage", {
        name: "ARKHAM_HORROR.Settings.TokenShowDamage.Name",
        hint: "ARKHAM_HORROR.Settings.TokenShowDamage.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "tokenOverlayAbove", {
        name: "ARKHAM_HORROR.Settings.TokenOverlayAbove.Name",
        hint: "ARKHAM_HORROR.Settings.TokenOverlayAbove.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register("arkham-horror-rpg-fvtt", "characterLoadCapacity", {
        name: "ARKHAM_HORROR.Settings.CharacterLoadCapacity.Name",
        hint: "ARKHAM_HORROR.Settings.CharacterLoadCapacity.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "characterInjuryTable", {
        name: "ARKHAM_HORROR.Settings.CharacterInjuryTable.Name",
        hint: "ARKHAM_HORROR.Settings.CharacterInjuryTable.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: () => {
            const tables = {};
            tables[""] = "";
            for (const table of game.tables) {
                tables[table.id] = table.name;
            }
            return tables;
        },
        default: ""
    });
    
    game.settings.register("arkham-horror-rpg-fvtt", "characterTraumaTableVariant", {
        name: "ARKHAM_HORROR.Settings.CharacterTraumaTableVariant.Name",
        hint: "ARKHAM_HORROR.Settings.CharacterTraumaTableVariant.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            standard: "ARKHAM_HORROR.Settings.CharacterTraumaTableVariant.Choices.Standard",
            noPersonality: "ARKHAM_HORROR.Settings.CharacterTraumaTableVariant.Choices.NoPersonality",
        },
        default: "standard"
    });
    
    game.settings.register("arkham-horror-rpg-fvtt", "characterHorrorTable", {
        name: "ARKHAM_HORROR.Settings.CharacterTraumaTable.Name",
        hint: "ARKHAM_HORROR.Settings.CharacterTraumaTable.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: () => {
            const tables = {};
            tables[""] = "";
            for (const table of game.tables) {
                tables[table.id] = table.name;
            }
            return tables;
        },
        default: ""
    });



    game.settings.register("arkham-horror-rpg-fvtt", "characterHorrorTableNoPersonality", {
        name: "ARKHAM_HORROR.Settings.CharacterTraumaTableNoPersonality.Name",
        hint: "ARKHAM_HORROR.Settings.CharacterTraumaTableNoPersonality.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: () => {
            const tables = {};
            tables[""] = "";
            for (const table of game.tables) {
                tables[table.id] = table.name;
            }
            return tables;
        },
        default: ""
    });

    game.settings.register("arkham-horror-rpg-fvtt", "npcInjuryTable", {
        name: "ARKHAM_HORROR.Settings.NpcInjuryTable.Name",
        hint: "ARKHAM_HORROR.Settings.NpcInjuryTable.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: () => {
            const tables = {};
            tables[""] = "";
            for (const table of game.tables) {
                tables[table.id] = table.name;
            }
            return tables;
        },
        default: ""
    });
    game.settings.register("arkham-horror-rpg-fvtt", "npcHorrorTable", {
        name: "ARKHAM_HORROR.Settings.NpcTraumaTable.Name",
        hint: "ARKHAM_HORROR.Settings.NpcTraumaTable.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: () => {
            const tables = {};
            tables[""] = "";
            for (const table of game.tables) {
                tables[table.id] = table.name;
            }
            return tables;
        },
        default: ""
    });
}