import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This React Compiler rule flags the fetch-on-mount pattern
      // (`useEffect(() => { load() }, [load])`) used throughout this codebase
      // for data loading — ~165 call sites. Rewriting all of them to avoid
      // setState-in-effect is a real data-fetching refactor (e.g. onto
      // useSWR/react-query), not a mechanical lint fix, so it's tracked as
      // its own follow-up rather than blocking CI on it now. Downgraded to
      // warn (not disabled) so new violations stay visible without failing
      // builds.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
