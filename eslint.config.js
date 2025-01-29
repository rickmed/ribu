// @ts-check
import eslint from "@eslint/js"
import ts_eslint from "typescript-eslint"
import functional from "eslint-plugin-functional"

export default ts_eslint.config({
	extends: [
		eslint.configs.recommended,
		...ts_eslint.configs.recommendedTypeChecked,
	],
	plugins: {
		"@typescript-eslint": ts_eslint.plugin,
		functional,
	},
	languageOptions: {
		parserOptions: {
			project: true,
			tsconfigRootDir: import.meta.dirname,
		},
	},
	rules: {
		semi: ["error", "never"],
		indent: ["error", "tab"],
		"no-trailing-spaces": "error",
		"no-mixed-spaces-and-tabs": "error",
		quotes: [
			"error",
			"double",
			{
				allowTemplateLiterals: true,
			},
		],
		"no-console": "error",
		"prefer-const": "off",
		curly: ["error", "multi-line"],
		"@typescript-eslint/no-this-alias": [
			"error",
			{
				allowedNames: ["me"],
			},
		],
		"@typescript-eslint/await-thenable": "error",
		"@typescript-eslint/ban-ts-comment": "off",
		"@typescript-eslint/method-signature-style": ["error", "property"],
		"functional/immutable-data": [
			"error",
			{
				ignoreClasses: true,
				ignoreAccessorPattern: "**.*_m*.**",
				ignoreNonConstDeclarations: {
					treatParametersAsConst: true,
				},
			},
		],
		"@typescript-eslint/no-unused-vars": ["error", {
			varsIgnorePattern: "^_",
			argsIgnorePattern: "^_"
		}]
	}
})
