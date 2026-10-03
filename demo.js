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
    console.log('Local demo ready. Demo accounts are documented in README.md. Press Ctrl+C to stop.');
    let stopping = false;
    async function stop() {
        if (stopping) return;
        stopping = true;
        server.close();
        await require('mongoose').disconnect();
        await database.stop({ doCleanup: false });
        process.exit(0);
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
demo().catch((error) => {
    console.error('Demo startup failed:', error.message.replace(/mongodb[^\s]+/g, '[database URI]'));
    process.exit(1);
});
