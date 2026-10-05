const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const hide = (text) => String(text).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database URI]');
const message = (error) => (error instanceof Error ? error.stack || error.message : String(error));
const log = createLog(path.join(__dirname, 'demo-log.txt'));

function createLog(logFile) {
    return function log(...parts) {
        const line = '[' + new Date().toISOString() + '] ' + hide(parts.join(' '));
        console.log(line);
        try {
            fs.appendFileSync(logFile, line + '\n');
        } catch {
            console.log('Could not write demo-log.txt. Check the folder permissions.');
        }
    };
}

async function demo() {
    log('Demo diagnostics: Node ' + process.version + ', platform ' + process.platform + ', PID ' + process.pid + '.');
    if (process.env.NODE_ENV === 'production') throw new Error('Demo is only for local development.');
    const dbPath = path.join(__dirname, '.demo-data');
    fs.mkdirSync(dbPath, { recursive: true });
    log('Starting local demo MongoDB. First run downloads the MongoDB binary.');
    const database = await MongoMemoryReplSet.create({
        binary: { version: '7.0.24' },
        instanceOpts: [{ dbPath, port: 27018 }],
        replSet: { name: 'campusDemo', count: 1, storageEngine: 'wiredTiger' },
    });
    // Record database-process problems instead of letting them stop the demo without an explanation.
    for (const member of database.servers) {
        const mongod = /** @type {import('node:events').EventEmitter | undefined} */ (
            member.instanceInfo && member.instanceInfo.instance
        );
        if (!mongod) continue;
        mongod.on('instanceError', (error) => log('Database process error:', message(error)));
        mongod.on('instanceClosed', (code, signal) =>
            log('Database process closed. code=' + code + ' signal=' + signal),
        );
    }
    process.env.MONGO_URI = database.getUri('college_events_demo');
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.ADMIN_EMAIL = 'admin@campus.example';
    process.env.ADMIN_PASSWORD = 'CampusDemo123!';
    process.env.NODE_ENV = 'development';
    process.env.SMTP_HOST = '';
    process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
    const { startServer } = require('./server');
    const { seedDemo } = require('./seed');
    const server = await startServer();
    await seedDemo();
    const address = server.address();
    const url = `http://localhost:${typeof address === 'object' ? address.port : address}`;
    log('Local demo ready. Open ' + url + ' in your browser.');
    log('Keep this terminal open. Press Ctrl+C to stop; there is no automatic shutdown timer.');
    const started = Date.now();
    const minutesUp = () => Math.round((Date.now() - started) / 60000);
    const keepAlive = setInterval(() => {
        server.ref();
        log('Still running. Minutes up: ' + minutesUp() + '. Listening: ' + server.listening + '.');
    }, 60000);
    let stopping = false;
    async function stop(reason, exitCode = 0) {
        if (stopping) return;
        stopping = true;
        clearInterval(keepAlive);
        log('Stopping local demo after ' + minutesUp() + ' minutes: ' + reason + '.');
        try {
            if (server.listening) await new Promise((resolve) => server.close(resolve));
            await require('mongoose').disconnect();
            await database.stop({ doCleanup: false });
            log('Local demo stopped. Your database data has been kept.');
            process.exit(exitCode);
        } catch (error) {
            log('Demo shutdown failed:', error.message);
            process.exit(1);
        }
    }
    process.on('SIGINT', () => stop('Ctrl+C / SIGINT received'));
    process.on('SIGTERM', () => stop('termination signal received from the terminal or operating system'));
    if (process.platform === 'win32') process.on('SIGBREAK', () => stop('Ctrl+Break received'));
    process.on('SIGHUP', () => stop('the terminal window or session was closed'));
    process.on('uncaughtException', (error) => stop('unexpected program error: ' + message(error), 1));
    process.on('unhandledRejection', (reason) => stop('unhandled background failure: ' + message(reason), 1));
    server.on('close', () => {
        if (!stopping) stop('HTTP server closed unexpectedly', 1);
    });
    process.on('exit', (code) => {
        if (!stopping) log('Demo exited unexpectedly with code ' + code + '. Please send demo-log.txt.');
    });
}
demo().catch((error) => {
    log('Demo startup failed:', message(error));
    process.exit(1);
});
