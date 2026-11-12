import stylistic from '@stylistic/eslint-plugin';

export default [
    {
        files: ['extension/**/*.js', 'tools/**/*.js'],
        plugins: {
            stylistic,
        },
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                global: 'readonly',
                print: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                _: 'readonly',
                N_: 'readonly',
                C_: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'stylistic/indent': ['error', 4, {SwitchCase: 1}],
            'stylistic/quotes': ['error', 'single', {avoidEscape: true}],
            'stylistic/semi': ['error', 'always'],
        },
    },
];
