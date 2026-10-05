require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const { marked } = require('marked');
const sanitize = require('sanitize-html');
const {
    categories,
    statuses,
    User,
    Venue,
    Event,
    Registration,
    Feedback,
    Notification,
    Suggestion,
    Activity,
} = require('./models');
const {
    fail,
    hashPassword,
    checkPassword,
    accountInput,
    list,
    source,
    owns,
    eventInput,
    sentiment,
    notify,
    notifyAttendees,
    sendReminders,
} = require('./helpers');
const { buildReport } = require('./reports');
const { demoPassword, demoUsers } = require('./demo-users');

const uploadFolder = path.join(__dirname, 'uploads');
const publicUser = (user) => ({
    id: String(user._id),
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
});

async function requireLogin(req, res, next) {
    const user = req.session.userId ? await User.findById(req.session.userId) : null;
    fail(!user || !user.active, 'Please log in.', 401);
    req.user = user;
    next();
}

function requireRole(...roles) {
    return [
        requireLogin,
        (req, res, next) => {
            fail(!roles.includes(req.user.role), 'You do not have permission for this action.', 403);
            next();
        },
    ];
}

async function managedEvent(req, dbSession = null) {
    const event = await Event.findById(req.params.id).session(dbSession);
    fail(!event, 'Event not found.', 404);
    fail(!owns(req.user, event), 'You can only manage your own events.', 403);
    return event;
}

async function visibleEvent(req) {
    const event = await Event.findById(req.params.id)
        .populate('venue')
        .populate('organizer', 'name email organizationRegistrationNumber verified');
    const user = req.session.userId ? await User.findById(req.session.userId) : null;
    const participant = user?.active && event ? await Registration.exists({ event: event._id, user: user._id }) : false;
    fail(
        !event || (event.status !== 'approved' && (!user?.active || (!owns(user, event) && !participant))),
        'Event not found.',
        404,
    );
    return event;
}

async function promote(eventId, dbSession) {
    const event = await Event.findOneAndUpdate(
        { _id: eventId, status: 'approved', start: { $gt: new Date() }, $expr: { $lt: ['$registered', '$capacity'] } },
        { $inc: { registered: 1 } },
        { session: dbSession },
    );
    if (!event) return;
    const next = await Registration.findOneAndUpdate(
        { event: eventId, status: 'waitlisted' },
        { status: 'registered' },
        { sort: { createdAt: 1 }, session: dbSession },
    );
    if (!next) await Event.updateOne({ _id: eventId }, { $inc: { registered: -1 } }, { session: dbSession });
    else
        await Notification.create(
            [{ user: next.user, message: `A seat opened for ${event.title}. You are now registered.` }],
            { session: dbSession },
        );
}

async function cancelRSVP(registration, dbSession) {
    fail(!registration || registration.status === 'cancelled', 'Registration not found.', 404);
    fail(!['registered', 'waitlisted'].includes(registration.status), 'An attendance record cannot be cancelled.');
    const previous = registration.status;
    const eventId = registration.event._id || registration.event;
    registration.status = 'cancelled';
    await registration.save({ session: dbSession });
    if (previous === 'registered') {
        await Event.updateOne({ _id: eventId }, { $inc: { registered: -1 } }, { session: dbSession });
        await promote(eventId, dbSession);
    }
    await Notification.create([{ user: registration.user, message: 'Your registration was cancelled.' }], {
        session: dbSession,
    });
}

function createApp(store) {
    const app = express();
    fail(
        !process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace-with-a-long-random-value',
        'Set a private SESSION_SECRET in .env.',
    );
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));
    app.use(
        session({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            store: store || MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
            cookie: {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                maxAge: 86400000,
            },
        }),
    );
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
            fail(
                req.headers.origin !== (process.env.BASE_URL || 'http://localhost:3000'),
                'Cross-origin requests are not allowed.',
                403,
            );
        }
        next();
    });
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(
        '/media',
        (req, res, next) => {
            if (!/^\/[a-f\d-]{36}\.png$/.test(req.path)) return res.sendStatus(404);
            next();
        },
        express.static(uploadFolder, { dotfiles: 'deny', index: false }),
    );
    // Private screenshots are never served by the public media route.
    app.use('/media', (req, res) => res.sendStatus(404));
    if (process.env.NODE_ENV !== 'test') {
        app.use(
            '/api/auth',
            rateLimit({
                windowMs: 900000,
                limit: 60,
                standardHeaders: 'draft-7',
                legacyHeaders: false,
                message: { error: 'Too many attempts. Please try later.' },
            }),
        );
    }

    app.get('/api/config', (req, res) =>
        res.json({
            categories,
            statuses,
            budgetThreshold: Number(process.env.BUDGET_THRESHOLD || 10000),
            demoMail: !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production',
            demoUsers: process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production' ? demoUsers : [],
            demoPassword: process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production' ? demoPassword : '',
        }),
    );
    app.get('/api/health', (req, res) =>
        res.json({
            database: mongoose.connection.readyState === 1 ? 'connected' : 'offline',
            uptime: Math.round(process.uptime()),
        }),
    );
    app.get('/api/auth/me', async (req, res) => {
        const user = req.session.userId ? await User.findById(req.session.userId) : null;
        res.json(user?.active ? publicUser(user) : null);
    });
    app.post('/api/auth/register', async (req, res) => {
        const fields = accountInput(req.body);
        const password = String(req.body.password || '');
        fail(password.length < 8 || password.length > 128, 'Password must contain 8–128 characters.');
        const role = req.body.role === 'organizer' ? 'organizer' : 'student';
        const orgNumber = String(req.body.orgRegNo || '').trim();
        fail(
            role === 'organizer' && !/^[\w/-]{3,50}$/.test(orgNumber),
            'Enter a valid organization registration number (3–50 letters, digits, / or -).',
        );
        const token = crypto.randomBytes(32).toString('hex');
        const user = await User.create({
            ...fields,
            password: hashPassword(password),
            role,
            interests: list(req.body.interests),
            organizationRegistrationNumber: orgNumber,
            verified: role === 'student',
            verificationToken: crypto.createHash('sha256').update(token).digest('hex'),
            verificationExpires: new Date(Date.now() + 86400000),
        });
        const url = `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/verify?token=${token}`;
        let mailSent = false;
        if (process.env.SMTP_HOST) {
            const transport = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: Number(process.env.SMTP_PORT) === 465,
                auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
            });
            try {
                await transport.sendMail({
                    from: process.env.MAIL_FROM,
                    to: user.email,
                    subject: 'Confirm your Campus Events email',
                    text: `Confirm your email (valid 24 hours): ${url}`,
                });
                mailSent = true;
            } catch {
                /* The account remains unverified until confirmation succeeds. */
            }
        }
        await Activity.create({ user: user._id, action: 'signup' });
        const preview = !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production';
        res.status(201).json({
            message: mailSent
                ? 'Check your email to confirm your account.'
                : preview
                  ? 'Development mode: open the confirmation link below, then log in.'
                  : 'Account created, but confirmation email could not be delivered. Contact the administrator.',
            verificationUrl: preview ? url : undefined,
        });
    });
    app.get('/api/auth/verify', async (req, res) => {
        const token = crypto
            .createHash('sha256')
            .update(String(req.query.token || ''))
            .digest('hex');
        const user = await User.findOneAndUpdate(
            { verificationToken: token, verificationExpires: { $gt: new Date() } },
            { emailVerified: true, $unset: { verificationToken: '', verificationExpires: '' } },
        );
        fail(!user, 'This confirmation link has expired or was already used.');
        res.redirect('/?verified=1');
    });
    app.post('/api/auth/login', async (req, res) => {
        const user = await User.findOne({
            email: String(req.body.email || '')
                .trim()
                .toLowerCase(),
        }).select('+password');
        fail(
            !user || !user.active || !checkPassword(String(req.body.password || ''), user.password),
            'Incorrect email or password.',
            401,
        );
        fail(!user.emailVerified, 'Confirm your email before logging in.', 403);
        await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
        req.session.userId = String(user._id);
        await Activity.create({ user: user._id, action: 'login' });
        res.json(publicUser(user));
    });
    app.post('/api/auth/logout', (req, res) =>
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ success: true });
        }),
    );

    app.get('/api/profile', requireLogin, (req, res) => res.json(req.user));
    app.put('/api/profile', requireLogin, async (req, res) => {
        const fields = accountInput({ ...req.body, email: req.user.email });
        Object.assign(req.user, fields, {
            interests: list(req.body.interests),
            preferences: { reminders: req.body.reminders !== false, connect: req.body.connect === true },
        });
        await req.user.save();
        res.json(publicUser(req.user));
    });
    app.delete('/api/profile', requireLogin, async (req, res) => {
        fail(req.user.role === 'admin', 'Admin accounts cannot deactivate themselves.');
        const upcoming = await Event.distinct('_id', {
            status: { $in: ['pending', 'approved'] },
            end: { $gt: new Date() },
        });
        fail(
            await Registration.exists({
                user: req.user._id,
                event: { $in: upcoming },
                status: { $in: ['registered', 'waitlisted'] },
            }),
            'Cancel your upcoming registrations before deactivating.',
        );
        fail(
            await Event.exists({ organizer: req.user._id, _id: { $in: upcoming } }),
            'Cancel your upcoming events before deactivating.',
        );
        await User.updateOne({ _id: req.user._id }, { active: false });
        req.session.destroy(() => res.json({ success: true }));
    });
    app.get('/api/admin/users', requireRole('admin'), async (req, res) =>
        res.json(await User.find().sort('-createdAt')),
    );
    app.post('/api/admin/users', requireRole('admin'), async (req, res) => {
        const fields = accountInput(req.body);
        const password = String(req.body.password || '');
        const role = String(req.body.role || 'student');
        fail(!['admin', 'organizer', 'student'].includes(role), 'Choose a valid role.');
        fail(password.length < 8 || password.length > 128, 'Password must contain 8–128 characters.');
        const number = String(req.body.organizationRegistrationNumber || '').trim();
        fail(
            role === 'organizer' && !/^[\w/-]{3,50}$/.test(number),
            'Enter a valid organization registration number (3–50 letters, digits, / or -).',
        );
        const user = await User.create({
            ...fields,
            password: hashPassword(password),
            role,
            emailVerified: true,
            verified: role !== 'organizer' || req.body.verified === true,
            organizationRegistrationNumber: role === 'organizer' ? number : '',
        });
        await Activity.create({ user: user._id, action: 'signup' });
        res.status(201).json(publicUser(user));
    });
    app.put('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
        const user = await User.findById(req.params.id);
        fail(!user, 'User not found.', 404);
        fail(String(user._id) === String(req.user._id), 'You cannot change your own admin status.');
        if (req.body.name !== undefined || req.body.email !== undefined || req.body.phone !== undefined) {
            const fields = accountInput({ ...user.toObject(), ...req.body });
            fail(
                process.env.DEMO_MODE === 'true' &&
                    demoUsers.some((account) => account.email === user.email) &&
                    fields.email !== user.email,
                'Demo emails are fixed. Create another user for a new email.',
            );
            Object.assign(user, fields);
        }
        if (req.body.password) {
            const password = String(req.body.password);
            fail(password.length < 8 || password.length > 128, 'Password must contain 8–128 characters.');
            user.password = hashPassword(password);
        }
        if (req.body.verified !== undefined) {
            fail(
                user.role !== 'organizer' || !user.organizationRegistrationNumber || !user.emailVerified,
                'Only an email-confirmed organizer with a registration number can be verified.',
            );
            user.verified = req.body.verified === true;
        }
        if (req.body.active !== undefined) user.active = req.body.active === true;
        if (!user.active) {
            const upcoming = await Event.distinct('_id', {
                status: { $in: ['pending', 'approved'] },
                end: { $gt: new Date() },
            });
            fail(
                await Registration.exists({
                    user: user._id,
                    event: { $in: upcoming },
                    status: { $in: ['registered', 'waitlisted'] },
                }),
                'Cancel upcoming registrations before deactivating this account.',
            );
        }
        fail(
            !user.active &&
                (await Event.exists({
                    organizer: user._id,
                    status: { $in: ['pending', 'approved'] },
                    end: { $gt: new Date() },
                })),
            'Cancel upcoming events before deactivating this organizer.',
        );
        await user.save();
        res.json(await User.findById(user._id));
    });

    app.get('/api/venues', async (req, res) => {
        /** @type {any[]} */
        const venues = await Venue.find({ archived: false }).sort('name').lean();
        for (const venue of venues)
            venue.bookings = await Event.find({
                venue: venue._id,
                status: { $in: ['pending', 'approved'] },
                end: { $gt: new Date() },
            }).select('title start end');
        res.json(venues);
    });
    async function venueFields(body) {
        const capacity = Number(body.capacity);
        fail(
            !String(body.name || '').trim() || !String(body.location || '').trim(),
            'Venue name and location are required.',
        );
        fail(!Number.isInteger(capacity) || capacity < 1, 'Venue capacity must be a positive integer.');
        const images = Array.isArray(body.images) ? body.images : [];
        fail(
            images.some((image) => !/^\/media\/[a-f\d-]{36}\.png$/.test(image)),
            'Use uploaded venue images.',
        );
        return {
            name: String(body.name).trim(),
            location: String(body.location).trim(),
            capacity,
            amenities: list(body.amenities),
            images,
        };
    }
    app.post('/api/venues', requireRole('admin'), async (req, res) =>
        res.status(201).json(await Venue.create(await venueFields(req.body))),
    );
    app.put('/api/venues/:id', requireRole('admin'), async (req, res) => {
        const fields = await venueFields(req.body);
        fail(
            await Event.exists({
                venue: req.params.id,
                status: { $in: ['pending', 'approved'] },
                end: { $gt: new Date() },
                capacity: { $gt: fields.capacity },
            }),
            'Capacity cannot be reduced below a booked event capacity.',
        );
        const venue = await Venue.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true });
        fail(!venue, 'Venue not found.', 404);
        res.json(venue);
    });
    app.delete('/api/venues/:id', requireRole('admin'), async (req, res) => {
        fail(
            await Event.exists({
                venue: req.params.id,
                status: { $in: ['pending', 'approved'] },
                end: { $gt: new Date() },
            }),
            'Cancel or move upcoming events before archiving this venue.',
        );
        const venue = await Venue.findByIdAndUpdate(req.params.id, { archived: true });
        fail(!venue, 'Venue not found.', 404);
        res.json({ success: true });
    });

    app.get('/api/events', async (req, res) => {
        const user = req.session.userId ? await User.findById(req.session.userId) : null;
        const filter =
            user?.active && user.role === 'admin'
                ? {}
                : user?.active && user.role === 'organizer' && req.query.mine
                  ? { organizer: user._id }
                  : { status: 'approved', end: { $gt: new Date() } };
        if (req.query.status && user?.role === 'admin') filter.status = String(req.query.status);
        if (req.query.q)
            filter.title = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        if (req.query.category) filter.category = String(req.query.category);
        if (req.query.from) {
            fail(!Number.isFinite(new Date(String(req.query.from)).getTime()), 'Invalid date filter.');
            filter.start = { $gte: new Date(String(req.query.from)) };
        }
        if (req.query.location) {
            const venues = await Venue.find({
                location: { $regex: String(req.query.location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
            }).distinct('_id');
            filter.venue = { $in: venues };
        }
        res.json(await Event.find(filter).populate('venue').populate('organizer', 'name').sort('start'));
    });
    app.get('/api/events/:id', async (req, res) => {
        const event = await visibleEvent(req);
        const trafficSource = source(req.query.source);
        await Event.updateOne({ _id: event._id }, { $inc: { views: 1 } });
        if (!event.traffic.some((item) => item.source === trafficSource))
            await Event.updateOne(
                { _id: event._id, 'traffic.source': { $ne: trafficSource } },
                { $push: { traffic: { source: trafficSource } } },
            );
        await Event.updateOne({ _id: event._id, 'traffic.source': trafficSource }, { $inc: { 'traffic.$.views': 1 } });
        const feedback = await Feedback.find({ event: event._id }).populate('user', 'name').sort('-createdAt');
        res.json({ ...event.toObject(), descriptionHtml: sanitize(await marked.parse(event.description)), feedback });
    });
    app.post('/api/events', requireRole('organizer', 'admin'), async (req, res) => {
        const organizer = req.user.role === 'admin' ? await User.findById(req.body.organizer) : req.user;
        fail(
            !organizer ||
                organizer.role !== 'organizer' ||
                !organizer.active ||
                !organizer.emailVerified ||
                !organizer.verified,
            'Choose an active, email-confirmed and verified organizer.',
            403,
        );
        /** @type {InstanceType<typeof Event>} */
        let event;
        await mongoose.connection.transaction(async (dbSession) => {
            const fields = await eventInput(req.body, undefined, dbSession);
            await Venue.updateOne({ _id: fields.venue }, { $inc: { bookingVersion: 1 } }, { session: dbSession });
            event = (await Event.create([{ ...fields, organizer: organizer._id }], { session: dbSession }))[0];
        });
        res.status(201).json(event);
    });
    app.put('/api/events/:id', requireRole('organizer', 'admin'), async (req, res) => {
        fail(req.user.role === 'organizer' && !req.user.verified, 'Your organization must remain verified.', 403);
        /** @type {InstanceType<typeof Event>} */
        let event;
        await mongoose.connection.transaction(async (dbSession) => {
            event = await managedEvent(req, dbSession);
            fail(['cancelled', 'archived'].includes(event.status), 'Cancelled or archived events cannot be edited.');
            const fields = await eventInput({ ...event.toObject(), ...req.body }, event._id, dbSession);
            fail(fields.capacity < event.registered, 'Capacity cannot be below already allocated seats.');
            await Venue.updateOne({ _id: fields.venue }, { $inc: { bookingVersion: 1 } }, { session: dbSession });
            Object.assign(event, fields, { status: 'pending' });
            await event.save({ session: dbSession });
        });
        await notifyAttendees(
            event,
            `${event.title} was updated and is awaiting approval. Please check its new schedule.`,
        );
        res.json(event);
    });
    app.delete('/api/events/:id', requireRole('organizer', 'admin'), async (req, res) => {
        await mongoose.connection.transaction(async (dbSession) => {
            const event = await managedEvent(req, dbSession);
            const archive = req.query.archive === 'true';
            fail(!archive && event.end <= new Date(), 'Archive a completed event instead of cancelling it.');
            fail(
                archive && event.end > new Date() && event.status !== 'cancelled',
                'Cancel an upcoming event before archiving it.',
            );
            const registrations = await Registration.find({
                event: event._id,
                status: { $in: ['registered', 'waitlisted', 'checked-in'] },
            }).session(dbSession);
            event.status = archive ? 'archived' : 'cancelled';
            if (!archive) {
                event.registered = 0;
                await Registration.updateMany(
                    { event: event._id, status: { $in: ['registered', 'waitlisted'] } },
                    { status: 'cancelled' },
                    { session: dbSession },
                );
            }
            await event.save({ session: dbSession });
            await Notification.insertMany(
                registrations.map((item) => ({ user: item.user, message: `${event.title} has been ${event.status}.` })),
                { session: dbSession },
            );
        });
        res.json({ success: true });
    });
    app.put('/api/events/:id/review', requireRole('admin'), async (req, res) => {
        fail(!['approved', 'rejected'].includes(req.body.status), 'Choose approved or rejected.');
        /** @type {InstanceType<typeof Event>} */
        let event;
        await mongoose.connection.transaction(async (dbSession) => {
            event = await managedEvent(req, dbSession);
            fail(['cancelled', 'archived'].includes(event.status), 'Cancelled or archived events cannot be approved.');
            if (req.body.status === 'approved') {
                const organizer = await User.findById(event.organizer).session(dbSession);
                fail(!organizer?.active || !organizer.verified, 'Organizer must be active and verified.');
                await eventInput(event.toObject(), event._id, dbSession);
                await Venue.updateOne({ _id: event.venue }, { $inc: { bookingVersion: 1 } }, { session: dbSession });
            }
            event.status = req.body.status;
            event.reviewReason = String(req.body.reason || '').slice(0, 1000);
            await event.save({ session: dbSession });
        });
        await notify(event.organizer, `${event.title} was ${event.status}. ${event.reviewReason}`);
        res.json(event);
    });
    app.put('/api/events/:id/evaluation', requireRole('admin'), async (req, res) => {
        const event = await managedEvent(req);
        const rating = Number(req.body.rating);
        fail(event.end > new Date(), 'Evaluate execution after the event ends.');
        fail(!Number.isInteger(rating) || rating < 1 || rating > 5, 'Rating must be an integer from 1 to 5.');
        event.review = {
            rating,
            compliance: String(req.body.compliance || '').slice(0, 1000),
            strengths: String(req.body.strengths || '').slice(0, 1000),
            improvements: String(req.body.improvements || '').slice(0, 1000),
        };
        await event.save();
        await notify(event.organizer, `Admin evaluated ${event.title}: ${rating}/5. ${event.review.improvements}`);
        res.json(event);
    });

    app.post('/api/events/:id/register', requireRole('student'), async (req, res) => {
        /** @type {InstanceType<typeof Registration>} */
        let registration;
        await mongoose.connection.transaction(async (dbSession) => {
            const event = await Event.findOne({
                _id: req.params.id,
                status: 'approved',
                start: { $gt: new Date() },
            }).session(dbSession);
            fail(!event, 'Registration is closed.', 404);
            const organizer = await User.findById(event.organizer).session(dbSession);
            fail(!organizer?.active || !organizer.verified, 'Organizer is not currently verified.', 403);
            const existing = await Registration.findOne({ user: req.user._id, event: event._id }).session(dbSession);
            fail(existing && existing.status !== 'cancelled', 'You already registered for this event.', 409);
            const claimed = await Event.findOneAndUpdate(
                { _id: event._id, $expr: { $lt: ['$registered', '$capacity'] } },
                { $inc: { registered: 1, clicks: 1 } },
                { session: dbSession },
            );
            if (!claimed) await Event.updateOne({ _id: event._id }, { $inc: { clicks: 1 } }, { session: dbSession });
            const fields = {
                user: req.user._id,
                event: event._id,
                status: claimed ? 'registered' : 'waitlisted',
                qrCode: crypto.randomUUID(),
                source: source(req.body.source),
                reminderSent: false,
            };
            registration = existing
                ? await Registration.findByIdAndUpdate(existing._id, fields, { new: true, session: dbSession })
                : (await Registration.create([fields], { session: dbSession }))[0];
            if (!event.traffic.some((item) => item.source === fields.source))
                await Event.updateOne(
                    { _id: event._id, 'traffic.source': { $ne: fields.source } },
                    { $push: { traffic: { source: fields.source } } },
                    { session: dbSession },
                );
            await Event.updateOne(
                { _id: event._id, 'traffic.source': fields.source },
                { $inc: { 'traffic.$.registrations': 1, 'traffic.$.clicks': 1 } },
                { session: dbSession },
            );
        });
        await notify(req.user._id, `RSVP confirmed: you are ${registration.status} for this event.`);
        res.status(201).json(registration);
    });
    app.delete('/api/events/:id/register', requireRole('student'), async (req, res) => {
        await mongoose.connection.transaction(async (dbSession) => {
            const registration = await Registration.findOne({ user: req.user._id, event: req.params.id }).session(
                dbSession,
            );
            await cancelRSVP(registration, dbSession);
        });
        res.json({ success: true });
    });
    app.delete('/api/registrations/:id', requireRole('organizer', 'admin'), async (req, res) => {
        await mongoose.connection.transaction(async (dbSession) => {
            const registration = await Registration.findById(req.params.id).populate('event').session(dbSession);
            fail(!registration, 'Registration not found.', 404);
            fail(!owns(req.user, registration.event), 'Not your event.', 403);
            await cancelRSVP(registration, dbSession);
        });
        res.json({ success: true });
    });
    app.get('/api/my/registrations', requireRole('student'), async (req, res) =>
        res.json(
            await Registration.find({ user: req.user._id })
                .populate({ path: 'event', populate: { path: 'venue' } })
                .sort('-createdAt'),
        ),
    );
    app.get('/api/events/:id/attendees', requireRole('organizer', 'admin'), async (req, res) => {
        await managedEvent(req);
        res.json(await Registration.find({ event: req.params.id }).populate('user', 'name email').sort('createdAt'));
    });
    app.get('/api/registrations/:id/qr', requireLogin, async (req, res) => {
        const registration = await Registration.findById(req.params.id).populate('event');
        fail(!registration, 'Registration not found.', 404);
        fail(
            String(registration.user) !== String(req.user._id) && !owns(req.user, registration.event),
            'Not your registration.',
            403,
        );
        res.type('png').send(await QRCode.toBuffer(registration.qrCode));
    });
    app.put('/api/registrations/:id/status', requireRole('organizer', 'admin'), async (req, res) => {
        /** @type {any} */
        const registration = await Registration.findById(req.params.id).populate('event');
        fail(!registration, 'Registration not found.', 404);
        fail(!owns(req.user, registration.event), 'Not your event.', 403);
        fail(
            !['checked-in', 'no-show'].includes(req.body.status) || registration.status !== 'registered',
            'Only a registered attendee can be checked in or marked no-show.',
        );
        fail(registration.event.status !== 'approved', 'Attendance is only available for approved events.');
        fail(
            req.body.status === 'checked-in' && registration.event.start > new Date(),
            'Check-in opens when the event starts.',
        );
        fail(
            req.body.status === 'checked-in' && registration.event.end < new Date(),
            'Check-in closes when the event ends.',
        );
        fail(
            req.body.status === 'no-show' && registration.event.end > new Date(),
            'Mark no-shows after the event ends.',
        );
        registration.status = req.body.status;
        if (registration.status === 'checked-in') registration.checkedInAt = new Date();
        await registration.save();
        res.json(registration);
    });
    app.post('/api/events/:id/check-in', requireRole('organizer', 'admin'), async (req, res) => {
        const event = await managedEvent(req);
        fail(event.status !== 'approved' || event.start > new Date(), 'Check-in opens when the approved event starts.');
        fail(event.end < new Date(), 'Check-in closes when the event ends.');
        const registration = await Registration.findOneAndUpdate(
            { event: event._id, qrCode: String(req.body.qrCode || ''), status: 'registered' },
            { status: 'checked-in', checkedInAt: new Date() },
            { new: true },
        );
        fail(!registration, 'Invalid code or attendee already checked in.');
        res.json(registration);
    });
    app.get('/api/events/:id/connect', requireRole('student'), async (req, res) => {
        await visibleEvent(req);
        fail(!req.user.preferences.connect, 'Enable attendee connections in your profile first.');
        fail(
            !(await Registration.exists({
                event: req.params.id,
                user: req.user._id,
                status: { $in: ['registered', 'checked-in'] },
            })),
            'Register for the event first.',
            403,
        );
        const ids = await Registration.distinct('user', {
            event: req.params.id,
            status: { $in: ['registered', 'checked-in'] },
        });
        res.json(
            await User.find({ _id: { $in: ids, $ne: req.user._id }, active: true, 'preferences.connect': true }).select(
                'name email interests',
            ),
        );
    });

    app.get('/api/events/:id/feedback', async (req, res) => {
        await visibleEvent(req);
        res.json(await Feedback.find({ event: req.params.id }).populate('user', 'name'));
    });
    app.post('/api/events/:id/feedback', requireRole('student'), async (req, res) => {
        const event = await Event.findById(req.params.id);
        fail(!event || event.end > new Date(), 'Feedback opens after the event ends.');
        fail(
            !(await Registration.exists({ user: req.user._id, event: event._id, status: 'checked-in' })),
            'Only attended events can be reviewed.',
            403,
        );
        const fields = {};
        for (const key of ['rating', 'quality', 'organization', 'venueSuitability', 'relevance', 'value']) {
            fields[key] = Number(req.body[key]);
            fail(
                !Number.isInteger(fields[key]) || fields[key] < 1 || fields[key] > 5,
                'Every rating must be an integer from 1 to 5.',
            );
        }
        fields.comment = String(req.body.comment || '');
        fail(fields.comment.length > 1000, 'Feedback is limited to 1000 characters.');
        fields.sentiment = sentiment(fields.comment);
        res.status(201).json(
            await Feedback.findOneAndUpdate({ event: event._id, user: req.user._id }, fields, {
                upsert: true,
                new: true,
                runValidators: true,
            }),
        );
    });
    app.delete('/api/feedback/:id', requireLogin, async (req, res) => {
        const feedback = await Feedback.findById(req.params.id);
        fail(!feedback, 'Feedback not found.', 404);
        fail(req.user.role !== 'admin' && String(feedback.user) !== String(req.user._id), 'Not your feedback.', 403);
        await feedback.deleteOne();
        res.json({ success: true });
    });
    app.put('/api/feedback/:id/response', requireRole('organizer', 'admin'), async (req, res) => {
        /** @type {any} */
        const feedback = await Feedback.findById(req.params.id).populate('event');
        fail(!feedback, 'Feedback not found.', 404);
        fail(!owns(req.user, feedback.event), 'Not your event.', 403);
        feedback.response = String(req.body.response || '');
        await feedback.save();
        await notify(feedback.user, `The organizer responded to your feedback on ${feedback.event.title}.`);
        res.json(feedback);
    });

    app.get('/api/notifications', requireLogin, async (req, res) =>
        res.json(await Notification.find({ user: req.user._id }).sort('-createdAt')),
    );
    app.put('/api/notifications/read', requireLogin, async (req, res) => {
        await Notification.updateMany({ user: req.user._id }, { read: true });
        res.json({ success: true });
    });
    app.put('/api/notifications/:id/archive', requireLogin, async (req, res) => {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { archived: true, read: true },
        );
        fail(!notification, 'Notification not found.', 404);
        res.json({ success: true });
    });
    app.delete('/api/notifications', requireLogin, async (req, res) => {
        await Notification.deleteMany({ user: req.user._id, $or: [{ archived: true }, { read: true }] });
        res.json({ success: true });
    });
    app.post('/api/events/:id/notify', requireRole('organizer', 'admin'), async (req, res) => {
        const event = await managedEvent(req);
        const message = String(req.body.message || '').trim();
        fail(!message || message.length > 1000, 'Enter a message up to 1000 characters.');
        await notifyAttendees(event, `${event.title}: ${message}`);
        res.json({ success: true });
    });

    app.get('/api/suggestions', requireLogin, async (req, res) =>
        res.json(
            await Suggestion.find(req.user.role === 'admin' ? {} : { user: req.user._id })
                .populate('user', 'name')
                .sort('-createdAt'),
        ),
    );
    app.post('/api/suggestions', requireLogin, async (req, res) => {
        fail(
            req.body.screenshot && !String(req.body.screenshot).startsWith(`/api/screenshots/private-${req.user._id}-`),
            'Use your own uploaded screenshot.',
        );
        res.status(201).json(
            await Suggestion.create({
                user: req.user._id,
                type: req.body.type,
                title: req.body.title,
                details: req.body.details,
                screenshot: req.body.screenshot,
            }),
        );
    });
    app.put('/api/suggestions/:id', requireRole('admin'), async (req, res) => {
        const suggestion = await Suggestion.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status, response: req.body.response },
            { new: true, runValidators: true },
        );
        fail(!suggestion, 'Suggestion not found.', 404);
        await notify(suggestion.user, `Your submission "${suggestion.title}" is ${suggestion.status}.`);
        res.json(suggestion);
    });

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, callback) => callback(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
    });
    app.post('/api/uploads', requireLogin, upload.single('image'), async (req, res) => {
        fail(!req.file, 'Choose a JPG or PNG image, maximum 5 MB.');
        const screenshot = req.body.kind === 'screenshot';
        fail(!screenshot && req.user.role === 'student', 'Only organizers/admins upload event and venue images.', 403);
        let metadata;
        try {
            metadata = await sharp(req.file.buffer, { limitInputPixels: 25000000 }).metadata();
        } catch {
            fail(true, 'Choose a valid JPG or PNG image within the image size limits.');
        }
        fail(!['jpeg', 'png'].includes(metadata.format), 'Image content must be JPG or PNG.');
        fs.mkdirSync(uploadFolder, { recursive: true });
        const filename = `${screenshot ? 'private-' + req.user._id + '-' : ''}${crypto.randomUUID()}.png`;
        await sharp(req.file.buffer)
            .rotate()
            .resize({ width: 1200, height: 800, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: 9 })
            .toFile(path.join(uploadFolder, filename));
        res.status(201).json({ url: (screenshot ? '/api/screenshots/' : '/media/') + filename });
    });
    app.get('/api/screenshots/:name', requireLogin, (req, res) => {
        const filename = req.params.name;
        fail(!/^private-[a-f\d]{24}-[a-f\d-]{36}\.png$/.test(filename), 'Screenshot not found.', 404);
        fail(
            req.user.role !== 'admin' && !filename.startsWith(`private-${req.user._id}-`),
            'Not your screenshot.',
            403,
        );
        res.sendFile(path.join(uploadFolder, filename));
    });

    app.get('/api/reports', requireLogin, async (req, res) => res.json(await buildReport(req.user)));
    app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status =
            error.status ||
            (error.code === 11000
                ? 409
                : ['ValidationError', 'CastError', 'MulterError'].includes(error.name)
                  ? 400
                  : 500);
        const message =
            error.code === 11000
                ? 'This record already exists (email, venue name, or event title per organizer/date).'
                : status === 500
                  ? 'Unable to complete this request. Please try again.'
                  : error.message;
        if (status === 500) console.error('Request failed:', error.name);
        res.status(status).json({ error: message });
    });
    return app;
}

async function bootstrapAdmin() {
    if (await User.exists({ role: 'admin' })) return;
    fail(
        !process.env.ADMIN_EMAIL ||
            !process.env.ADMIN_PASSWORD ||
            process.env.ADMIN_PASSWORD === 'choose-a-strong-password',
        'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env for the first start.',
    );
    fail(process.env.ADMIN_PASSWORD.length < 8, 'Admin password must have at least 8 characters.');
    await User.create({
        ...accountInput({ name: 'System Administrator', email: process.env.ADMIN_EMAIL, phone: '+919876543210' }),
        password: hashPassword(process.env.ADMIN_PASSWORD),
        role: 'admin',
        phone: '+919876543210',
        emailVerified: true,
        verified: true,
    });
}

async function startServer() {
    fail(!process.env.MONGO_URI, 'Set MONGO_URI in .env.');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    fail(
        !hello.setName && hello.msg !== 'isdbgrid',
        'Use MongoDB Atlas or a local replica set; registrations use transactions.',
    );
    await Promise.all(
        [User, Venue, Event, Registration, Feedback, Notification, Suggestion, Activity].map((model) => model.init()),
    );
    await bootstrapAdmin();
    const store = MongoStore.create({ mongoUrl: process.env.MONGO_URI });
    const app = createApp(store);
    const server = app.listen(process.env.PORT || 3000);
    await new Promise((resolve, reject) => {
        server.once('listening', () => resolve(undefined));
        server.once('error', reject);
    });
    const address = server.address();
    console.log(`Campus Events ready on port ${typeof address === 'object' ? address.port : address}`);
    sendReminders().catch(() => console.error('Reminder check failed.'));
    const timer = setInterval(() => sendReminders().catch(() => console.error('Reminder check failed.')), 60000);
    timer.unref();
    server.on('close', () => {
        clearInterval(timer);
        store.close().catch(() => console.error('Session store shutdown failed.'));
    });
    return server;
}

if (require.main === module)
    startServer().catch((error) => {
        console.error('Startup failed:', error.message.replace(/mongodb[^\s]+/g, '[database URI]'));
        process.exit(1);
    });
module.exports = { createApp, startServer, bootstrapAdmin };
