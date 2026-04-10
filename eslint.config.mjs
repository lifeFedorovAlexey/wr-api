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
  {
    files: [
      "lib/guides.mjs",
      "lib/httpApiServer.mjs",
      "lib/newsEntityMapper.mjs",
      "lib/newsImport.mjs",
      "lib/riftggCnStats.mjs",
      "lib/updateChampions.mjs",
      "scripts/audit-guides-ui-e2e.mjs",
      "scripts/backfill-guide-hero-media.mjs",
      "scripts/import-cn-history.mjs",
      "scripts/import-riftgg-cn-stats.mjs",
      "scripts/setup-admin-tables.mjs",
      "scripts/setup-guides-table.mjs",
    ],
    rules: {
      // These long-lived integration modules are still intentionally monolithic;
      // keep the baseline linting on, but stop surfacing legacy complexity noise in CI.
      complexity: "off",
      "max-depth": "off",
      "max-lines-per-function": "off",
      "no-empty": "off",
      "no-unused-vars": "off",
    },
  },
];
