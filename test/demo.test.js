const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function demoHarness(platform = 'linux') {
    const output = [];
    const intervals = new Map();
    const exits = [];
    const stopOptions = [];
    let disconnects = 0;
    let refs = 0;
    const server = Object.assign(new EventEmitter(), {
        listening: true,
        address: () => ({ port: 3000 }),
        ref: () => refs++,
        close(callback) {
            this.listening = false;
            this.emit('close');
            callback();
        },
    });
    const fakeProcess = Object.assign(new EventEmitter(), {
        platform,
        env: {},
        exit: (code) => exits.push(code),
    });
    const database = {
        getUri: () => 'mongodb://127.0.0.1:27018/college_events_demo',
        stop: async (options) => stopOptions.push(options),
    };
    const modules = {
        crypto: require('node:crypto'),
        fs: { mkdirSync() {} },
        path,
        'mongodb-memory-server': { MongoMemoryReplSet: { create: async () => database } },
        './server': { startServer: async () => server },
        './seed': { seedDemo: async () => {} },
        mongoose: { disconnect: async () => disconnects++ },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'demo.js'), 'utf8'), {
        __dirname: path.join(__dirname, '..'),
        require(name) {
            assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
            return modules[name];
        },
        process: fakeProcess,
        console: {
            log: (...args) => output.push(args.join(' ')),
            error: (...args) => output.push(args.join(' ')),
        },
        setInterval(callback, delay) {
            const id = { callback, delay };
            intervals.set(id, callback);
            return id;
        },
        clearInterval: (id) => intervals.delete(id),
    });
    await new Promise(setImmediate);
    return {
        output,
        intervals,
        exits,
        stopOptions,
        server,
        fakeProcess,
        refs: () => refs,
        disconnects: () => disconnects,
    };
}

test('demo keeps a referenced timer and prints its browser URL without shutting down on ticks', async () => {
    const run = await demoHarness();
    assert.equal(run.intervals.size, 1);
    const [timer] = run.intervals.keys();
    assert.equal(timer.delay, 60000);
    for (let i = 0; i < 10; i++) timer.callback();
    assert.equal(run.refs(), 10);
    assert.deepEqual(run.exits, []);
    assert.deepEqual(run.stopOptions, []);
    assert.ok(run.output.some((line) => line.includes('http://localhost:3000')));
});

test('Ctrl+C clears the keep-alive, closes services and preserves demo data exactly once', async () => {
    const run = await demoHarness();
    run.fakeProcess.emit('SIGINT');
    run.fakeProcess.emit('SIGINT');
    await new Promise(setImmediate);
    assert.equal(run.intervals.size, 0);
    assert.equal(run.server.listening, false);
    assert.equal(run.disconnects(), 1);
    assert.deepEqual(JSON.parse(JSON.stringify(run.stopOptions)), [{ doCleanup: false }]);
    assert.deepEqual(run.exits, [0]);
    assert.ok(run.output.some((line) => line.includes('Ctrl+C / SIGINT received')));
});

test('external termination is logged rather than silently returning to the prompt', async () => {
    const run = await demoHarness();
    run.fakeProcess.emit('SIGTERM');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [0]);
    assert.ok(run.output.some((line) => line.includes('termination signal received')));
});

test('Windows Ctrl+Break follows the manual shutdown path', async () => {
    const run = await demoHarness('win32');
    run.fakeProcess.emit('SIGBREAK');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [0]);
    assert.equal(run.intervals.size, 0);
    assert.ok(run.output.some((line) => line.includes('Ctrl+Break received')));
});

test('unexpected server closure produces a diagnostic and nonzero exit', async () => {
    const run = await demoHarness();
    run.server.listening = false;
    run.server.emit('close');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [1]);
    assert.equal(run.intervals.size, 0);
    assert.ok(run.output.some((line) => line.includes('HTTP server closed unexpectedly')));
});
