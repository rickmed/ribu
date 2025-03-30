// @ts-check
import eslint from "@eslint/js"
import ts_eslint from "typescript-eslint"
import functional from "eslint-plugin-functional"

export default [
	...ts_eslint.config({
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
				project: ["./tsconfig.json", "./test/tsconfig.json"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			semi: ["error", "never"],
			indent: ["error", "tab", { "flatTernaryExpressions": true }],
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
			"@typescript-eslint/no-this-alias": "off",
			"@typescript-eslint/await-thenable": "error",
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/method-signature-style": ["error", "property"],
			"functional/immutable-data": [
				"error",
				{
					ignoreClasses: true,
					ignoreAccessorPattern: "**.*_m*.**",
					ignoreIdentifierPattern: ["this"],
					ignoreNonConstDeclarations: {
						treatParametersAsConst: false,
					},
				},
			],
			"@typescript-eslint/no-unused-vars": ["error", {
				varsIgnorePattern: "^_",
				argsIgnorePattern: "^_"
			}]
		}
	}),
	{
		files: ["eslint.config.js"],
		languageOptions: {
			parserOptions: {
				project: null
			}
		}
	}
]
