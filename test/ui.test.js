const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function frontend() {
    const elements = {};
    const context = vm.createContext({
        document: {
            querySelector: (selector) => (elements[selector] ||= { innerHTML: '', showModal() {}, close() {} }),
        },
        location: { hash: '', search: '', origin: 'http://localhost:3000' },
        window: { addEventListener() {}, scrollTo() {} },
        setTimeout,
        clearTimeout,
        URLSearchParams,
        console,
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    vm.runInContext(source.slice(0, source.lastIndexOf('run(async () =>')), context);
    vm.runInContext("config = { categories: ['Workshop', 'Sports'], budgetThreshold: 10000 };", context);
    return { context, elements };
}

test('frontend escaping and form helpers preserve validation attributes', () => {
    const { context } = frontend();
    assert.equal(
        vm.runInContext('esc(\'<img src="x" onerror="bad">\')', context),
        '&lt;img src=&quot;x&quot; onerror=&quot;bad&quot;&gt;',
    );
    const field = context.field('name', 'Name', 'text', '<script>', 'required minlength="2"');
    assert.ok(field.includes('value="&lt;script&gt;"'));
    assert.ok(field.includes('required minlength="2"'));
});
test('login and signup templates reference existing handlers and required fields', () => {
    const { context, elements } = frontend();
    for (const render of [context.login, context.signup]) {
        render();
        const html = elements['#app'].innerHTML;
        assert.ok(html.includes('name="email"'));
        assert.ok(html.includes('name="password"'));
        for (const match of html.matchAll(/on(?:click|submit)="(\w+)\(/g))
            assert.equal(typeof context[match[1]], 'function');
    }
});
test('navigation shows only role-appropriate links', () => {
    const { context, elements } = frontend();
    context.renderNavigation();
    assert.equal(elements['#nav'].innerHTML.includes('href="#reports"'), false);
    vm.runInContext("me = { id: '1', name: 'Admin', role: 'admin' };", context);
    context.renderNavigation();
    assert.ok(elements['#nav'].innerHTML.includes('href="#venues"'));
    vm.runInContext("me.role = 'student';", context);
    context.renderNavigation();
    assert.equal(elements['#nav'].innerHTML.includes('href="#venues"'), false);
    assert.ok(elements['#nav'].innerHTML.includes('href="#reports"'));
});
test('event cards render safe text, category, venue and seats', () => {
    const { context } = frontend();
    const html = context.eventCard({
        _id: '123',
        title: '<script>Bad</script>',
        description: 'A helpful workshop for students.',
        category: 'Workshop',
        start: new Date().toISOString(),
        capacity: 10,
        registered: 2,
        venue: { name: 'Hall', location: 'North campus' },
    });
    assert.ok(html.includes('&lt;script&gt;Bad&lt;/script&gt;'));
    assert.equal(html.includes('<script>'), false);
    assert.ok(html.includes('8 seats left'));
    assert.ok(html.includes('North campus'));
});
test('CSV export escapes quotes and protects spreadsheet formula cells', () => {
    const { context } = frontend();
    vm.runInContext(
        `currentReport = { tables: { Test: [{ name: '=SUM(1,2)', comment: 'say "hello"' }] } };
        download = (filename, content, type) => { globalThis.exported = { filename, content, type }; };`,
        context,
    );
    context.downloadCSV('Test');
    assert.ok(context.exported.content.includes('"\'=SUM(1,2)"'));
    assert.ok(context.exported.content.includes('"say ""hello"""'));
    assert.equal(context.exported.filename, 'test.csv');
});
