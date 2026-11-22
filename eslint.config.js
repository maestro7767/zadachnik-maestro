import tseslint from "typescript-eslint";

// Линтер для TypeScript-кода в src/ и tests/. Сгенерированные папки не проверяются.
export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  ...tseslint.configs.recommended,
);
