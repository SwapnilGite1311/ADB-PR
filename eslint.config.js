const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
    { ignores: ['node_modules/**', 'uploads/**', '.demo-data/**'] },
    js.configs.recommended,
    {
        files: ['*.js', 'test/**/*.js'],
        languageOptions: { sourceType: 'commonjs', globals: globals.node },
        rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
    },
    {
        files: ['public/**/*.js'],
        languageOptions: { sourceType: 'script', globals: globals.browser },
        rules: { 'no-unused-vars': 'off' },
    },
];
