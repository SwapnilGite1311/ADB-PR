const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, checkPassword, sentiment, accountInput, source, list, fail } = require('../helpers');
const { average, percent, groups, themes } = require('../reports');

test('passwords use random salts and reject incorrect or malformed hashes', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.notEqual(stored, hashPassword('correct horse battery staple'));
    assert.equal(checkPassword('correct horse battery staple', stored), true);
    assert.equal(checkPassword('wrong password', stored), false);
    assert.equal(checkPassword('anything', 'plaintext'), false);
    assert.equal(checkPassword('anything', 'a'.repeat(32) + ':' + 'z'.repeat(128)), false);
});
test('account validation normalizes email and enforces name, email, phone', () => {
    const data = { name: '  Student One ', email: ' STUDENT@EXAMPLE.COM ', phone: '+919876543210' };
    assert.deepEqual(accountInput(data), { name: 'Student One', email: 'student@example.com', phone: '+919876543210' });
    for (const invalid of [{ name: 'A' }, { email: 'not-an-email' }, { phone: '123' }, { phone: '+91 9876543210' }])
        assert.throws(() => accountInput({ ...data, ...invalid }));
});
test('sentiment uses explainable whole-word positive and negative scores', () => {
    assert.equal(sentiment('Great and useful workshop'), 'positive');
    assert.equal(sentiment('Boring and disappointing'), 'negative');
    assert.equal(sentiment('It was great but slow'), 'neutral');
    assert.equal(sentiment(''), 'neutral');
});
test('lists and promotion sources are normalized', () => {
    assert.deepEqual(list(' Workshop, Sports, ,coding '), ['Workshop', 'Sports', 'coding']);
    assert.equal(source('https://club/<script>'), 'httpsclubscript');
    assert.equal(source(null), 'direct');
    assert.equal(source('a'.repeat(60)).length, 50);
});
test('report calculations handle empty data and rounding', () => {
    assert.equal(average([]), 0);
    assert.equal(average([4, 5, 5]), 4.67);
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(0, 0), 0);
    assert.deepEqual(
        groups(['a', 'a', 'b'], (item) => item),
        [
            { label: 'a', count: 2 },
            { label: 'b', count: 1 },
        ],
    );
    assert.deepEqual(
        groups(['constructor', '__proto__'], (item) => item),
        [
            { label: 'constructor', count: 1 },
            { label: '__proto__', count: 1 },
        ],
    );
    assert.deepEqual(themes([{ comment: 'This event: coding coding helpful' }]), [
        { label: 'coding', count: 2 },
        { label: 'helpful', count: 1 },
    ]);
});
test('validation errors carry the intended HTTP status', () => {
    assert.doesNotThrow(() => fail(false, 'ignored'));
    assert.throws(() => fail(true, 'Forbidden', 403), { message: 'Forbidden', status: 403 });
});
