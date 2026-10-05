const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function demoHarness(platform = 'linux', startupError = null) {
    const output = [];
    const logged = [];
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
    const mongod = new EventEmitter();
    const fakeProcess = Object.assign(new EventEmitter(), {
        platform,
        version: process.version,
        pid: 123,
        env: {},
        stdin: { isTTY: false, resume: () => undefined },
        exit: (code) => exits.push(code),
    });
    const database = {
        servers: [{ instanceInfo: { instance: mongod } }],
        getUri: () => 'mongodb://127.0.0.1:27018/college_events_demo',
        stop: async (options) => stopOptions.push(options),
    };
    const modules = {
        crypto: require('node:crypto'),
        fs: { mkdirSync() {}, appendFileSync: (file, line) => logged.push([file, line]) },
        path,
        'mongodb-memory-server': {
            MongoMemoryReplSet: {
                create: async () => {
                    if (startupError) throw startupError;
                    return database;
                },
            },
        },
        './server': { startServer: async () => server },
        './seed': { seedDemo: async () => {} },
        mongoose: { disconnect: async () => disconnects++ },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'demo.js'), 'utf8'), {
        __dirname: path.join(__dirname, '..'),
        require(name) {
            assert.ok(Object.hasOwn(modules, name), 'Unexpected dependency: ' + name);
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
        Date,
    });
    await new Promise(setImmediate);
    return {
        output,
        logged,
        intervals,
        exits,
        stopOptions,
        server,
        mongod,
        fakeProcess,
        refs: () => refs,
        disconnects: () => disconnects,
        printed: (text) => output.some((line) => line.includes(text)),
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
    assert.ok(run.printed('http://localhost:3000'));
    assert.ok(run.printed('Still running. Minutes up: 0. Listening: true.'));
});

test('startup and heartbeat lines are appended to demo-log.txt for later diagnosis', async () => {
    const run = await demoHarness();
    const [timer] = run.intervals.keys();
    timer.callback();
    assert.ok(run.logged.length >= 3);
    for (const [file, line] of run.logged) {
        assert.equal(file, path.join(__dirname, '..', 'demo-log.txt'));
        assert.match(line, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] .+\n$/);
    }
    assert.ok(run.logged.some(([, line]) => line.includes('Local demo ready')));
    assert.ok(run.logged.some(([, line]) => line.includes('Still running')));
});

test('startup failures are saved to the diagnostic file even before the server starts', async () => {
    const run = await demoHarness('win32', new Error('MongoDB binary failed to launch'));
    assert.deepEqual(run.exits, [1]);
    assert.equal(run.intervals.size, 0);
    assert.ok(run.logged.some(([, line]) => line.includes('platform win32')));
    assert.ok(run.logged.some(([, line]) => line.includes('Demo startup failed:')));
    assert.ok(run.logged.some(([, line]) => line.includes('MongoDB binary failed to launch')));
});

test('database connection strings never reach the terminal or the log file', async () => {
    const run = await demoHarness();
    run.mongod.emit('instanceError', new Error('failed on mongodb://127.0.0.1:27018/college_events_demo'));
    run.mongod.emit('instanceError', new Error('failed on mongodb+srv://example.test/college_events_demo'));
    const written = run.output.concat(run.logged.map(([, line]) => line)).join('\n');
    assert.ok(!written.includes('mongodb://'));
    assert.ok(!written.includes('mongodb+srv://'));
    assert.ok(run.printed('[database URI]'));
});

test('database process failures are reported instead of ending the demo silently', async () => {
    const run = await demoHarness();
    run.mongod.emit('instanceError', new Error('mongod refused to start'));
    run.mongod.emit('instanceClosed', 14, null);
    assert.ok(run.printed('Database process error:'));
    assert.ok(run.printed('mongod refused to start'));
    assert.ok(run.printed('Database process closed. code=14 signal=null'));
    assert.deepEqual(run.exits, []);
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
    assert.ok(run.printed('Ctrl+C / SIGINT received'));
});

test('external termination is logged rather than silently returning to the prompt', async () => {
    const run = await demoHarness();
    run.fakeProcess.emit('SIGTERM');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [0]);
    assert.ok(run.printed('termination signal received'));
});

test('a closed terminal window is recorded as the shutdown reason', async () => {
    const run = await demoHarness();
    run.fakeProcess.emit('SIGHUP');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [0]);
    assert.ok(run.printed('terminal window or session was closed'));
});

test('Windows Ctrl+Break follows the manual shutdown path', async () => {
    const run = await demoHarness('win32');
    run.fakeProcess.emit('SIGBREAK');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [0]);
    assert.equal(run.intervals.size, 0);
    assert.ok(run.printed('Ctrl+Break received'));
});

test('crashes and background failures record their cause and exit with an error code', async () => {
    const crashed = await demoHarness();
    crashed.fakeProcess.emit('uncaughtException', new Error('sudden failure'));
    await new Promise(setImmediate);
    assert.deepEqual(crashed.exits, [1]);
    assert.ok(crashed.printed('unexpected program error'));
    assert.ok(crashed.printed('sudden failure'));

    const rejected = await demoHarness();
    rejected.fakeProcess.emit('unhandledRejection', new Error('background failure'));
    await new Promise(setImmediate);
    assert.deepEqual(rejected.exits, [1]);
    assert.ok(rejected.printed('unhandled background failure'));
    assert.ok(rejected.printed('background failure'));
});

test('unexpected server closure produces a diagnostic and nonzero exit', async () => {
    const run = await demoHarness();
    run.server.listening = false;
    run.server.emit('close');
    await new Promise(setImmediate);
    assert.deepEqual(run.exits, [1]);
    assert.equal(run.intervals.size, 0);
    assert.ok(run.printed('HTTP server closed unexpectedly'));
});
