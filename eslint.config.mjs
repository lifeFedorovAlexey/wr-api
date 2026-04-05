import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "scrapers/**"],
  },
  {
    files: [
      "api/utils/**/*.js",
      "lib/**/*.mjs",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        }
      ],
      "complexity": ["warn", 18],
      "max-depth": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        {
          max: 120,
          skipBlankLines: true,
          skipComments: true
        }
      ],
    }
  },
];
