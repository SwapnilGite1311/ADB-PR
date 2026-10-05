const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const request = require('supertest');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SMTP_HOST = '';
process.env.BASE_URL = 'http://localhost:3000';
const models = require('../models');
const { User, Venue, Event, Registration, Feedback, Notification } = models;
const { createApp, startServer } = require('../server');
const { hashPassword, eventInput, sendReminders } = require('../helpers');
const { seedDemo } = require('../seed');
let database, app;
const files = [];
const password = 'TestPassword123!';

before(async () => {
    database = await MongoMemoryReplSet.create({
        binary: { version: '7.0.24' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(database.getUri());
    await Promise.all(
        Object.values(models)
            .filter((model) => model.init)
            .map((model) => model.init()),
    );
    app = createApp(new session.MemoryStore());
});
beforeEach(async () => {
    await Promise.all(
        Object.values(models)
            .filter((model) => model.deleteMany)
            .map((model) => model.deleteMany({})),
    );
});
after(async () => {
    for (const file of files) fs.rmSync(file, { force: true });
    await mongoose.disconnect();
    if (database) await database.stop();
});

async function account(role, name, verified = true) {
    const user = await User.create({
        role,
        name,
        email: `${name}@example.com`,
        password: hashPassword(password),
        phone: '+919876543210',
        emailVerified: true,
        verified,
        organizationRegistrationNumber: role === 'organizer' ? 'CLUB-001' : '',
        interests: ['Workshop'],
    });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: user.email, password }).expect(200);
    return { user, agent };
}
async function context() {
    const admin = await account('admin', 'admin');
    const organizer = await account('organizer', 'organizer');
    const student = await account('student', 'student');
    const other = await account('student', 'otherstudent');
    const venue = (
        await admin.agent
            .post('/api/venues')
            .send({ name: 'Auditorium', location: 'North campus', capacity: 10, amenities: 'Wi-Fi, Stage' })
            .expect(201)
    ).body;
    const start = new Date(Date.now() + 172800000);
    const body = {
        title: 'Campus coding workshop',
        description: 'A practical workshop for students to learn useful coding skills together with friendly mentors.',
        category: 'Workshop',
        start,
        end: new Date(+start + 7200000),
        capacity: 1,
        budget: 1000,
        venue: venue._id,
    };
    const event = (await organizer.agent.post('/api/events').send(body).expect(201)).body;
    await admin.agent.put(`/api/events/${event._id}/review`).send({ status: 'approved' }).expect(200);
    return { admin, organizer, student, other, venue, body, event };
}

test('signup requires email confirmation, unique email, and never exposes password', async () => {
    const data = { name: 'New student', email: 'new@example.com', phone: '+919876543210', password, role: 'admin' };
    const signup = await request(app).post('/api/auth/register').send(data).expect(201);
    const user = await User.findOne({ email: data.email }).select('+password');
    assert.equal(user.role, 'student');
    assert.notEqual(user.password, password);
    await request(app).post('/api/auth/login').send(data).expect(403);
    await request(app).post('/api/auth/register').send(data).expect(409);
    const link = new URL(signup.body.verificationUrl);
    await request(app)
        .get(link.pathname + link.search)
        .expect(302);
    await request(app)
        .get(link.pathname + link.search)
        .expect(400);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send(data).expect(200);
    assert.equal(login.body.password, undefined);
    const profile = await agent.get('/api/profile').expect(200);
    assert.equal(profile.body.password, undefined);
    assert.equal(profile.body.verificationToken, undefined);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/profile').expect(401);
});
test('admin creates accounts with hashed passwords, while public signup cannot create admins', async () => {
    const c = await context();
    const data = {
        name: 'Created Student',
        email: 'created@example.com',
        phone: '+919876543210',
        password,
        role: 'student',
    };
    await request(app).post('/api/admin/users').send(data).expect(401);
    await c.student.agent.post('/api/admin/users').send(data).expect(403);
    await c.organizer.agent.post('/api/admin/users').send(data).expect(403);
    const created = (await c.admin.agent.post('/api/admin/users').send(data).expect(201)).body;
    assert.equal(created.role, 'student');
    assert.equal(created.password, undefined);
    const saved = await User.findOne({ email: data.email }).select('+password');
    assert.notEqual(saved.password, password);
    assert.equal(saved.emailVerified, true);
    await request(app).post('/api/auth/login').send(data).expect(200);
    await c.admin.agent.post('/api/admin/users').send(data).expect(409);
    await c.admin.agent
        .post('/api/admin/users')
        .send({ ...data, email: 'bad@example.com', password: 'short' })
        .expect(400);
    await c.admin.agent
        .post('/api/admin/users')
        .send({ ...data, email: 'bad@example.com', role: 'other' })
        .expect(400);
    await c.admin.agent
        .post('/api/admin/users')
        .send({ ...data, email: 'neworg@example.com', role: 'organizer' })
        .expect(400);
    const organizer = (
        await c.admin.agent
            .post('/api/admin/users')
            .send({
                ...data,
                email: 'neworg@example.com',
                role: 'organizer',
                organizationRegistrationNumber: 'CLUB/002',
            })
            .expect(201)
    ).body;
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'neworg@example.com', password }).expect(200);
    await agent.post('/api/events').send(c.body).expect(403);
    await c.admin.agent
        .put('/api/admin/users/' + organizer.id)
        .send({ verified: true })
        .expect(200);
    await agent
        .post('/api/events')
        .send({
            ...c.body,
            start: new Date(+new Date(c.body.start) + 86400000),
            end: new Date(+new Date(c.body.end) + 86400000),
        })
        .expect(201);
    const admin = (
        await c.admin.agent
            .post('/api/admin/users')
            .send({ ...data, email: 'secondadmin@example.com', role: 'admin' })
            .expect(201)
    ).body;
    assert.equal(admin.role, 'admin');
});

test('admin edits user details and resets a password without returning its hash', async () => {
    const c = await context();
    const changed = (
        await c.admin.agent
            .put('/api/admin/users/' + c.other.user._id)
            .send({
                name: 'Updated Student',
                email: 'updated@example.com',
                password: 'UpdatedPassword123!',
            })
            .expect(200)
    ).body;
    assert.equal(changed._id, String(c.other.user._id));
    assert.equal(changed.name, 'Updated Student');
    assert.equal(changed.password, undefined);
    await request(app).post('/api/auth/login').send({ email: changed.email, password }).expect(401);
    await request(app)
        .post('/api/auth/login')
        .send({ email: changed.email, password: 'UpdatedPassword123!' })
        .expect(200);
    await c.student.agent
        .put('/api/admin/users/' + c.other.user._id)
        .send({ password })
        .expect(403);
    await c.admin.agent
        .put('/api/admin/users/' + c.admin.user._id)
        .send({ active: false })
        .expect(400);
});

test('admin creates events for verified organizers; organizer cannot impersonate another owner', async () => {
    const c = await context();
    const body = {
        ...c.body,
        title: 'Admin-created workshop',
        organizer: String(c.organizer.user._id),
        start: new Date(+new Date(c.body.start) + 86400000),
        end: new Date(+new Date(c.body.end) + 86400000),
    };
    const event = (await c.admin.agent.post('/api/events').send(body).expect(201)).body;
    assert.equal(event.organizer, String(c.organizer.user._id));
    assert.equal(event.status, 'pending');
    await c.organizer.agent
        .put('/api/events/' + event._id)
        .send({ title: 'Owner manages admin-created event' })
        .expect(200);
    await c.admin.agent
        .put('/api/events/' + event._id + '/review')
        .send({ status: 'approved' })
        .expect(200);
    await c.admin.agent
        .post('/api/events')
        .send({ ...body, organizer: c.student.user._id })
        .expect(403);
    await c.admin.agent
        .post('/api/events')
        .send({ ...body, organizer: undefined })
        .expect(403);
    const outsider = await account('organizer', 'separateowner');
    const own = (
        await outsider.agent
            .post('/api/events')
            .send({
                ...body,
                start: new Date(+new Date(body.start) + 86400000),
                end: new Date(+new Date(body.end) + 86400000),
            })
            .expect(201)
    ).body;
    assert.equal(own.organizer, String(outsider.user._id));
    await outsider.agent
        .put('/api/events/' + event._id)
        .send({ title: 'Unauthorized edit' })
        .expect(403);
    await outsider.agent.delete('/api/events/' + event._id).expect(403);
    await c.admin.agent.delete('/api/events/' + own._id).expect(200);
});

test('fixed demo logins recover from Compass edits and retain new accounts and IDs', async () => {
    await seedDemo();
    const extra = await account('student', 'persistentstudent');
    const originals = await User.find({ email: /@campus.example$/ }).lean();
    await User.updateMany(
        { email: /@campus.example$/ },
        {
            password: 'plain-text-compass-edit',
            active: false,
            verified: false,
            emailVerified: false,
            role: 'student',
        },
    );
    await seedDemo({ restoreLogins: true });
    for (const original of originals) {
        const agent = request.agent(app);
        const login = (
            await agent.post('/api/auth/login').send({ email: original.email, password: 'CampusDemo123!' }).expect(200)
        ).body;
        assert.equal(login.role, original.role);
        assert.equal(login.id, String(original._id));
        await agent.get('/api/auth/me').expect(200);
        await agent.post('/api/auth/logout').expect(200);
    }
    await request(app).post('/api/auth/login').send({ email: extra.user.email, password }).expect(200);
    assert.equal(await User.countDocuments(), 4);
    assert.equal(await Event.countDocuments(), 7);
    assert.equal(await Registration.countDocuments(), 1);
    assert.equal(await Feedback.countDocuments(), 1);
});

test('demo login hints are not exposed in normal or production mode', async () => {
    const oldMode = process.env.DEMO_MODE;
    const oldNodeEnv = process.env.NODE_ENV;
    try {
        delete process.env.DEMO_MODE;
        assert.deepEqual((await request(app).get('/api/config').expect(200)).body.demoUsers, []);
        process.env.DEMO_MODE = 'true';
        assert.equal((await request(app).get('/api/config').expect(200)).body.demoUsers.length, 3);
        process.env.NODE_ENV = 'production';
        assert.equal((await request(app).get('/api/config').expect(200)).body.demoPassword, '');
    } finally {
        if (oldMode === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = oldMode;
        process.env.NODE_ENV = oldNodeEnv;
    }
});

test('role checks, organization verification, and foreign ownership protect mutations', async () => {
    const c = await context();
    await request(app).post('/api/venues').send({}).expect(401);
    await c.student.agent.post('/api/venues').send({}).expect(403);
    await c.student.agent.get('/api/admin/users').expect(403);
    const outsider = await account('organizer', 'outsider');
    await outsider.agent.put(`/api/events/${c.event._id}`).send(c.body).expect(403);
    const unverified = await account('organizer', 'unverified', false);
    await unverified.agent.post('/api/events').send(c.body).expect(403);
    await c.student.agent
        .put('/api/profile')
        .send({ name: 'Student Name', phone: '+919876543210', role: 'admin', reminders: false, connect: true })
        .expect(200);
    const user = await User.findById(c.student.user._id);
    assert.equal(user.role, 'student');
    assert.equal(user.preferences.connect, true);
});
test('event validation enforces dates, duration, capacity, budget, category and uploads', async () => {
    const c = await context();
    const start = new Date(Date.now() + 864000000);
    const valid = { ...c.body, title: 'Another event', start, end: new Date(+start + 7200000) };
    for (const invalid of [
        { title: 'A' },
        { description: 'short' },
        { category: 'Other' },
        { start: 'invalid' },
        { start: new Date(0) },
        { end: new Date(+start + 1000) },
        { capacity: 0 },
        { capacity: 11 },
        { budget: -1 },
        { budget: 11000 },
        { poster: 'https://external.example/poster.png' },
    ]) {
        await assert.rejects(() => eventInput({ ...valid, ...invalid }), undefined, JSON.stringify(invalid));
    }
    const fields = await eventInput({ ...valid, budget: 11000, breakdown: [{ label: 'Equipment', amount: 11000 }] });
    assert.equal(fields.budget, 11000);
});
test('unique event title per organizer/date and venue conflict are enforced', async () => {
    const c = await context();
    const venue = await Venue.create({ name: 'Second hall', location: 'South campus', capacity: 10 });
    await c.organizer.agent
        .post('/api/events')
        .send({ ...c.body, venue: venue._id, title: c.body.title.toUpperCase() })
        .expect(409);
    await c.organizer.agent
        .post('/api/events')
        .send({ ...c.body, title: 'Conflicting booking' })
        .expect(409);
});
test('simultaneous bookings cannot reserve the same venue time', async () => {
    const c = await context();
    const start = new Date(Date.now() + 864000000);
    const body = { ...c.body, start, end: new Date(+start + 7200000) };
    const results = await Promise.all(
        ['First booking', 'Second booking'].map((title) =>
            c.organizer.agent.post('/api/events').send({ ...body, title }),
        ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
});
test('concurrent registrations allocate one seat, waitlist others, and promote FIFO', async () => {
    const c = await context();
    const responses = await Promise.all(
        [c.student.agent, c.other.agent].map((agent) =>
            agent.post(`/api/events/${c.event._id}/register`).send({ source: 'newsletter' }),
        ),
    );
    assert.ok(responses.every((result) => result.status === 201));
    assert.deepEqual(responses.map((result) => result.body.status).sort(), ['registered', 'waitlisted']);
    assert.equal((await Event.findById(c.event._id)).registered, 1);
    const agents = [c.student.agent, c.other.agent];
    const active = responses.findIndex((result) => result.body.status === 'registered');
    await agents[active].post(`/api/events/${c.event._id}/register`).send({}).expect(409);
    await agents[active].delete(`/api/events/${c.event._id}/register`).expect(200);
    const promoted = await Registration.findById(responses[1 - active].body._id);
    assert.equal(promoted.status, 'registered');
    assert.equal((await Event.findById(c.event._id)).registered, 1);
    assert.ok(await Notification.exists({ user: promoted.user, message: /seat opened/ }));
    await agents[active].post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    assert.equal((await Registration.findById(responses[active].body._id)).status, 'waitlisted');
});
test('waitlist cancellation does not free an allocated seat and deactivation is guarded', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.other.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.other.agent.delete(`/api/events/${c.event._id}/register`).expect(200);
    assert.equal((await Event.findById(c.event._id)).registered, 1);
    await c.student.agent.delete('/api/profile').expect(400);
    await c.organizer.agent.delete('/api/profile').expect(400);
    await c.student.agent.delete(`/api/events/${c.event._id}/register`).expect(200);
    await c.student.agent.delete('/api/profile').expect(200);
    await c.student.agent.get('/api/profile').expect(401);
});
test('editing events resets approval; allocated seats and upcoming venue bookings are protected', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.admin.agent
        .put(`/api/venues/${c.venue._id}`)
        .send({ name: 'Hall', location: 'North', capacity: 0 })
        .expect(400);
    await c.admin.agent.delete(`/api/venues/${c.venue._id}`).expect(400);
    await c.organizer.agent
        .put(`/api/events/${c.event._id}`)
        .send({ ...c.body, capacity: 2 })
        .expect(200);
    assert.equal((await Event.findById(c.event._id)).status, 'pending');
    await c.other.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(404);
    await c.admin.agent.put(`/api/events/${c.event._id}/review`).send({ status: 'approved' }).expect(200);
});
test('QR tickets are private; check-in is time-bound, once-only, and organizer controlled', async () => {
    const c = await context();
    const registration = (await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201)).body;
    await c.other.agent.get(`/api/registrations/${registration._id}/qr`).expect(403);
    const qr = await c.student.agent.get(`/api/registrations/${registration._id}/qr`).expect(200);
    assert.match(qr.headers['content-type'], /image\/png/);
    await c.student.agent.post(`/api/events/${c.event._id}/check-in`).send({ qrCode: registration.qrCode }).expect(403);
    await c.organizer.agent
        .post(`/api/events/${c.event._id}/check-in`)
        .send({ qrCode: registration.qrCode })
        .expect(400);
    await Event.updateOne(
        { _id: c.event._id },
        { start: new Date(Date.now() - 60000), end: new Date(Date.now() + 3600000) },
    );
    await c.organizer.agent
        .post(`/api/events/${c.event._id}/check-in`)
        .send({ qrCode: registration.qrCode })
        .expect(200);
    await c.organizer.agent
        .post(`/api/events/${c.event._id}/check-in`)
        .send({ qrCode: registration.qrCode })
        .expect(400);
    assert.equal((await Registration.findById(registration._id)).status, 'checked-in');
});
test('feedback requires completed checked-in attendance and supports edit, response, delete', async () => {
    const c = await context();
    const feedback = {
        rating: 5,
        quality: 5,
        organization: 4,
        venueSuitability: 5,
        relevance: 5,
        value: 5,
        comment: 'Great and useful event.',
    };
    await c.student.agent.post(`/api/events/${c.event._id}/feedback`).send(feedback).expect(400);
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await Registration.updateOne({ user: c.student.user._id }, { status: 'checked-in', checkedInAt: new Date() });
    await Event.updateOne(
        { _id: c.event._id },
        { start: new Date(Date.now() - 7200000), end: new Date(Date.now() - 1000) },
    );
    await c.other.agent.post(`/api/events/${c.event._id}/feedback`).send(feedback).expect(403);
    await c.student.agent
        .post(`/api/events/${c.event._id}/feedback`)
        .send({ ...feedback, rating: 6 })
        .expect(400);
    const created = (await c.student.agent.post(`/api/events/${c.event._id}/feedback`).send(feedback).expect(201)).body;
    assert.equal(created.sentiment, 'positive');
    const edited = (
        await c.student.agent
            .post(`/api/events/${c.event._id}/feedback`)
            .send({ ...feedback, rating: 4 })
            .expect(201)
    ).body;
    assert.equal(created._id, edited._id);
    assert.equal(await Feedback.countDocuments(), 1);
    await c.organizer.agent
        .put(`/api/feedback/${created._id}/response`)
        .send({ response: 'Thank you for attending.' })
        .expect(200);
    await c.other.agent.delete(`/api/feedback/${created._id}`).expect(403);
    await c.student.agent.delete(`/api/feedback/${created._id}`).expect(200);
});
test('notifications are private, readable, archivable, and clearable', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.organizer.agent
        .post(`/api/events/${c.event._id}/notify`)
        .send({ message: 'Bring your laptop.' })
        .expect(200);
    const notifications = (await c.student.agent.get('/api/notifications').expect(200)).body;
    assert.ok(notifications.length >= 2);
    await c.other.agent.put(`/api/notifications/${notifications[0]._id}/archive`).expect(404);
    await c.student.agent.put(`/api/notifications/${notifications[0]._id}/archive`).expect(200);
    await c.student.agent.put('/api/notifications/read').expect(200);
    await c.student.agent.delete('/api/notifications').expect(200);
    assert.equal((await c.student.agent.get('/api/notifications')).body.length, 0);
});
test('reminders are sent once only and respect student preferences', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await Event.updateOne({ _id: c.event._id }, { start: new Date(Date.now() + 3600000) });
    await sendReminders();
    await sendReminders();
    assert.equal(await Notification.countDocuments({ user: c.student.user._id, message: /^Reminder:/ }), 1);
    await Registration.updateOne({ user: c.student.user._id }, { reminderSent: false });
    await User.updateOne({ _id: c.student.user._id }, { 'preferences.reminders': false });
    await sendReminders();
    assert.equal(await Notification.countDocuments({ user: c.student.user._id, message: /^Reminder:/ }), 1);
});
test('uploads enforce image ownership, dimensions and size; bug reports track implementation', async () => {
    const c = await context();
    const png = await sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#6366f1' } })
        .png()
        .toBuffer();
    await c.student.agent.post('/api/uploads').attach('image', png, 'poster.png').expect(403);
    await c.admin.agent
        .post('/api/uploads')
        .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
        .expect(400);
    await c.admin.agent.post('/api/uploads').attach('image', Buffer.from('not an image'), 'fake.png').expect(400);
    const uploaded = (
        await c.student.agent
            .post('/api/uploads')
            .field('kind', 'screenshot')
            .attach('image', png, 'issue.png')
            .expect(201)
    ).body;
    const filename = path.basename(uploaded.url);
    files.push(path.join(__dirname, '..', 'uploads', filename));
    const info = await sharp(files[files.length - 1]).metadata();
    assert.ok(info.width <= 1200 && info.height <= 800);
    await request(app).get(uploaded.url).expect(401);
    await c.other.agent.get(uploaded.url).expect(403);
    await request(app)
        .get('/media/' + filename)
        .expect(404);
    await c.student.agent.get(uploaded.url).expect(200);
    await c.admin.agent.get(uploaded.url).expect(200);
    const bug = (
        await c.student.agent
            .post('/api/suggestions')
            .send({
                type: 'bug',
                title: 'Improve navigation',
                details: 'A sufficiently detailed description of the issue.',
                screenshot: uploaded.url,
            })
            .expect(201)
    ).body;
    await c.other.agent
        .post('/api/suggestions')
        .send({
            type: 'bug',
            title: 'Other issue',
            details: 'Another sufficiently detailed report.',
            screenshot: uploaded.url,
        })
        .expect(400);
    await c.admin.agent
        .put(`/api/suggestions/${bug._id}`)
        .send({ status: 'implemented', response: 'Completed.' })
        .expect(200);
    assert.equal((await c.student.agent.get('/api/suggestions')).body[0].status, 'implemented');
});
test('reports isolate roles, include required analytics, and recommendations exclude joined events', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    const student = (await c.student.agent.get('/api/reports').expect(200)).body;
    assert.equal(student.metrics['My registrations'], 1);
    assert.equal(student.tables['Attendee report'], undefined);
    assert.equal(
        student.recommendations.some((event) => event._id === c.event._id),
        false,
    );
    const organizer = (await c.organizer.agent.get('/api/reports').expect(200)).body;
    assert.equal(organizer.tables['Event analytics'].length, 1);
    assert.equal(organizer.tables['Event analytics'][0].registered, 1);
    const admin = (await c.admin.agent.get('/api/reports').expect(200)).body;
    for (const table of [
        'Venue utilization',
        'Login trends',
        'Organizer performance',
        'Student engagement',
        'Promotion effectiveness',
        'System activity',
        'Platform submission statuses',
    ])
        assert.ok(Array.isArray(admin.tables[table]));
    const outsider = await account('organizer', 'outsider');
    assert.equal((await outsider.agent.get('/api/reports')).body.tables['Event analytics'].length, 0);
});
test('event browsing filters correctly and Markdown is sanitized', async () => {
    const c = await context();
    assert.equal((await request(app).get('/api/events?q=campus&category=Workshop&location=North')).body.length, 1);
    assert.equal((await request(app).get('/api/events?category=Sports')).body.length, 0);
    await Event.updateOne(
        { _id: c.event._id },
        { description: '**Hello** <script>alert(1)</script> <img src=x onerror=alert(1)>' },
    );
    const details = (await request(app).get(`/api/events/${c.event._id}?source=newsletter`).expect(200)).body;
    assert.ok(details.descriptionHtml.includes('<strong>Hello</strong>'));
    assert.equal(details.descriptionHtml.includes('<script'), false);
    assert.equal(details.descriptionHtml.includes('onerror'), false);
});
test('cancellation frees registrations, blocks new RSVP, and archiving preserves history', async () => {
    const c = await context();
    await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.organizer.agent.delete(`/api/events/${c.event._id}`).expect(200);
    assert.equal((await Registration.findOne({ event: c.event._id })).status, 'cancelled');
    assert.equal((await Event.findById(c.event._id)).registered, 0);
    await c.other.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(404);
    await c.student.agent.get(`/api/events/${c.event._id}`).expect(200);
    await request(app).get(`/api/events/${c.event._id}`).expect(404);
    await c.organizer.agent.delete(`/api/events/${c.event._id}?archive=true`).expect(200);
    assert.equal((await Event.findById(c.event._id)).status, 'archived');
});
test('security headers and cross-origin mutation policy are present', async () => {
    const response = await request(app).get('/api/config').expect(200);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['cache-control'], 'no-store');
    await request(app).post('/api/auth/login').set('Origin', 'https://external.example').send({}).expect(403);
    await request(app).get('/api/not-a-route').expect(404);
});
test('demo seed is repeatable without duplicate accounts, events, registrations or reviews', async () => {
    await seedDemo();
    await seedDemo();
    assert.equal(await User.countDocuments(), 3);
    assert.equal(await Event.countDocuments(), 7);
    assert.equal(await Registration.countDocuments(), 1);
    assert.equal(await Feedback.countDocuments(), 1);
    assert.equal((await Event.findOne({ title: 'Creative coding recap' })).registered, 1);
});

test('organizers manage cancellations and no-shows; students connect only with mutual opt-in', async () => {
    const c = await context();
    await Event.updateOne({ _id: c.event._id }, { capacity: 2 });
    const registration = (await c.student.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201)).body;
    await c.other.agent.post(`/api/events/${c.event._id}/register`).send({}).expect(201);
    await c.student.agent.get(`/api/events/${c.event._id}/connect`).expect(400);
    await User.updateMany({ role: 'student' }, { 'preferences.connect': true });
    const peers = (await c.student.agent.get(`/api/events/${c.event._id}/connect`).expect(200)).body;
    assert.equal(peers.length, 1);
    assert.equal(peers[0].email, c.other.user.email);
    await c.admin.agent.put(`/api/admin/users/${c.student.user._id}`).send({ active: false }).expect(400);
    await c.organizer.agent
        .put(`/api/registrations/${registration._id}/status`)
        .send({ status: 'no-show' })
        .expect(400);
    await Event.updateOne(
        { _id: c.event._id },
        { start: new Date(Date.now() - 7200000), end: new Date(Date.now() - 1000) },
    );
    await c.organizer.agent
        .put(`/api/registrations/${registration._id}/status`)
        .send({ status: 'no-show' })
        .expect(200);
    await c.organizer.agent.delete(`/api/registrations/${registration._id}`).expect(400);
    const other = await Registration.findOne({ user: c.other.user._id });
    await c.organizer.agent.delete(`/api/registrations/${other._id}`).expect(200);
    assert.equal((await Event.findById(c.event._id)).registered, 1);
});
test('venue CRUD and administrator account verification/reactivation preserve permissions', async () => {
    const c = await context();
    const unverified = await account('organizer', 'neworganizer', false);
    await c.admin.agent.put(`/api/admin/users/${unverified.user._id}`).send({ verified: true }).expect(200);
    assert.equal((await User.findById(unverified.user._id)).verified, true);
    await c.admin.agent.put(`/api/admin/users/${c.other.user._id}`).send({ active: false }).expect(200);
    await c.other.agent.get('/api/profile').expect(401);
    await c.admin.agent.put(`/api/admin/users/${c.other.user._id}`).send({ active: true }).expect(200);
    await c.other.agent.get('/api/profile').expect(200);
    const venue = (
        await c.admin.agent
            .post('/api/venues')
            .send({ name: 'Small hall', location: 'West campus', capacity: 20 })
            .expect(201)
    ).body;
    await c.admin.agent
        .put(`/api/venues/${venue._id}`)
        .send({ name: 'Updated hall', location: 'West campus', capacity: 25, amenities: 'Projector' })
        .expect(200);
    await c.admin.agent.delete(`/api/venues/${venue._id}`).expect(200);
    assert.equal((await Venue.findById(venue._id)).archived, true);
    assert.equal(
        (await c.admin.agent.get('/api/venues')).body.some((item) => item._id === venue._id),
        false,
    );
});
test('startup creates the first admin, uses MongoDB sessions, and serves the frontend', async () => {
    process.env.MONGO_URI = database.getUri();
    process.env.ADMIN_EMAIL = 'bootstrap@example.com';
    process.env.ADMIN_PASSWORD = password;
    process.env.PORT = '0';
    const server = await startServer();
    try {
        const agent = request.agent(server);
        const login = await agent
            .post('/api/auth/login')
            .send({ email: process.env.ADMIN_EMAIL, password })
            .expect(200);
        assert.equal(login.body.role, 'admin');
        await agent.get('/api/profile').expect(200);
        const html = await agent.get('/').expect(200);
        assert.ok(html.text.includes('/app.js'));
        await agent.get('/app.js').expect(200);
        await agent.post('/api/auth/logout').expect(200);
        assert.equal(await User.countDocuments({ role: 'admin' }), 1);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
