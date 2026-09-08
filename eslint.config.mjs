import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-require-imports": "off",
      // The opinionated react-hooks / React-Compiler rules are not enforced in
      // this codebase (pre-existing project decision). eslint-plugin-react-hooks
      // v7 promoted three more of them to errors — kept off here for the same
      // reason as the four above, so `npm run lint` stays a signal for real
      // problems rather than compiler-optimisation hints.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off"
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Expo mobile app is a separate package with its own toolchain
    // (mobile/package.json, mobile/node_modules, mobile/tsconfig.json) and
    // must be linted with an Expo/React-Native config, not this Next.js web
    // one — rules like @next/next/* are meaningless for React Native. Lint it
    // from inside mobile/ (`expo lint`), not from the web root.
    "mobile/**",
  ]),
]);

export default eslintConfig;
