const js = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");

module.exports = defineConfig({
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
        "@typescript-eslint/adjacent-overload-signatures": "error",
        "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as" }],
        "@typescript-eslint/naming-convention": [
            "error",
            { selector: "interface", format: null, custom: { regex: "^I[A-Z][a-z]", match: false } },
        ],
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-shadow": "error",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_$" }],
        "@typescript-eslint/unified-signatures": "error",
        eqeqeq: ["error", "always", { null: "ignore" }],
        "guard-for-in": "error",
        "no-bitwise": "error",
        "no-console": "error",
        "no-eval": "error",
        "no-undef-init": "error",
        "object-shorthand": "error",
        radix: "error",
    },
}, {
    files: ["srcElectron/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
        sourceType: "commonjs",
        globals: {
            __dirname: "readonly",
            console: "readonly",
            process: "readonly",
        },
    },
});
