const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

async function demo() {
    if (process.env.NODE_ENV === 'production') throw new Error('Demo is only for local development.');
    const dbPath = path.join(__dirname, '.demo-data');
    fs.mkdirSync(dbPath, { recursive: true });
    console.log('Starting local demo MongoDB. First run downloads the MongoDB binary.');
    const database = await MongoMemoryReplSet.create({
        binary: { version: '7.0.24' },
        instanceOpts: [{ dbPath, port: 27018 }],
        replSet: { name: 'campusDemo', count: 1, storageEngine: 'wiredTiger' },
    });
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
    console.log(`Local demo ready. Open ${url} in your browser.`);
    console.log('Keep this terminal open. Press Ctrl+C to stop; there is no automatic shutdown timer.');
    const keepAlive = setInterval(() => server.ref(), 60000);
    let stopping = false;
    async function stop(reason, exitCode = 0) {
        if (stopping) return;
        stopping = true;
        clearInterval(keepAlive);
        console.log(`Stopping local demo: ${reason}.`);
        try {
            if (server.listening) await new Promise((resolve) => server.close(resolve));
            await require('mongoose').disconnect();
            await database.stop({ doCleanup: false });
            console.log('Local demo stopped. Your database data has been kept.');
            process.exit(exitCode);
        } catch (error) {
            console.error('Demo shutdown failed:', error.message.replace(/mongodb[^\s]+/g, '[database URI]'));
            process.exit(1);
        }
    }
    process.on('SIGINT', () => stop('Ctrl+C / SIGINT received'));
    process.on('SIGTERM', () => stop('termination signal received from the terminal or operating system'));
    if (process.platform === 'win32') process.on('SIGBREAK', () => stop('Ctrl+Break received'));
    server.on('close', () => {
        if (!stopping) stop('HTTP server closed unexpectedly', 1);
    });
    process.on('exit', (code) => {
        if (!stopping) console.error(`Demo exited unexpectedly with code ${code}. Please share the terminal output.`);
    });
}
demo().catch((error) => {
    console.error('Demo startup failed:', error.message.replace(/mongodb[^\s]+/g, '[database URI]'));
    process.exit(1);
});
