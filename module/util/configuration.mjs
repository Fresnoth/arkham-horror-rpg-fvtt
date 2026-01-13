export function setupConfiguration() {
    game.settings.register("arkham-horror-rpg-fvtt", "tokenShowDicePools", {
        name: "Show Token Dice Pools",
        hint: "Show Dice Pool below tokens on the canvas.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "tokenShowDamage", {
        name: "Show Token Damage",
        hint: "Show Damage below tokens on the canvas.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "characterLoadCapacity", {
        name: "Character Load Capacity",
        hint: "Automatic Load Capacity calculation",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("arkham-horror-rpg-fvtt", "characterInjuryTable", {
        name: "Character Injury Table",
        hint: "Used for rolling injuries",
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
        name: "Character Trauma Table Variant",
        hint: "Choose which character trauma table to use when rolling trauma.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            standard: "Standard",
            noPersonality: "No-Personality",
        },
        default: "standard"
    });
    
    game.settings.register("arkham-horror-rpg-fvtt", "characterHorrorTable", {
        name: "Character Trauma Table",
        hint: "Used for rolling trauma",
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
        name: "Character Trauma Table (No-Personality)",
        hint: "Optional alternate trauma table with fewer entries (no personality trait effects).",
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
        name: "NPC Injury Table",
        hint: "Used for rolling injuries",
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
        name: "NPC Trauma Table",
        hint: "Used for rolling trauma",
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