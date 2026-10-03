const crypto = require('crypto');
const validator = require('validator');
const { categories, User, Venue, Event, Registration, Notification } = require('./models');

function fail(condition, message, status = 400) {
    if (condition) throw Object.assign(new Error(message), { status });
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

function checkPassword(password, stored) {
    const [salt, hash] = String(stored).split(':');
    if (!/^[a-f\d]{32}$/.test(salt || '') || !/^[a-f\d]{128}$/.test(hash || '')) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

function accountInput(body) {
    const name = String(body.name || '').trim();
    const email = String(body.email || '')
        .trim()
        .toLowerCase();
    const phone = String(body.phone || '').trim();
    fail(name.length < 2 || name.length > 100, 'Name must contain 2–100 characters.');
    fail(!validator.isEmail(email), 'Enter a valid email address.');
    fail(!/^\+?\d{10,15}$/.test(phone), 'Phone must contain 10–15 digits, optionally prefixed with +.');
    return { name, email, phone };
}

const list = (text) =>
    String(text || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
const source = (text) =>
    String(text || 'direct')
        .replace(/[^\w -]/g, '')
        .slice(0, 50) || 'direct';
const owns = (user, event) =>
    user.role === 'admin' || String(event.organizer._id || event.organizer) === String(user._id);

async function eventInput(body, id, dbSession = null) {
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const start = new Date(body.start);
    const end = new Date(body.end);
    const capacity = Number(body.capacity);
    const budget = Number(body.budget || 0);
    fail(title.length < 2 || title.length > 200, 'Title must contain 2–200 characters.');
    fail(description.length < 50, 'Description must contain at least 50 characters.');
    fail(!categories.includes(body.category), 'Choose a valid category.');
    fail(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()), 'Enter valid dates.');
    fail(start <= new Date() || +end - +start < 3600000, 'Choose a future start and a duration of at least one hour.');
    fail(!Number.isInteger(capacity) || capacity < 1, 'Capacity must be a positive integer.');
    fail(!Number.isFinite(budget) || budget < 0, 'Budget must be non-negative.');
    const venue = await Venue.findOne({ _id: body.venue, archived: false }).session(dbSession);
    fail(!venue, 'Choose an available venue.');
    fail(capacity > venue.capacity, 'Capacity cannot exceed the venue capacity.');
    const breakdown = Array.isArray(body.breakdown) ? body.breakdown : [];
    for (const item of breakdown) {
        fail(
            !String(item.label || '').trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0,
            'Budget items need a label and non-negative amount.',
        );
    }
    const total = breakdown.reduce((sum, item) => sum + Number(item.amount), 0);
    fail(
        budget > Number(process.env.BUDGET_THRESHOLD || 10000) &&
            (!breakdown.length || Math.abs(total - budget) > 0.01),
        'Above the budget threshold, item amounts must sum to the budget.',
    );
    const conflict = await Event.exists({
        _id: { $ne: id },
        venue: venue._id,
        status: { $in: ['pending', 'approved'] },
        start: { $lt: end },
        end: { $gt: start },
    }).session(dbSession);
    fail(conflict, 'The venue is already booked at that time.', 409);
    fail(body.poster && !/^\/media\/[a-f\d-]{36}\.png$/.test(body.poster), 'Use an uploaded poster image.');
    return {
        title,
        description,
        category: body.category,
        start,
        end,
        day: start.toISOString().slice(0, 10),
        venue: venue._id,
        capacity,
        budget,
        breakdown,
        poster: body.poster || '',
    };
}

function sentiment(text) {
    const words =
        String(text)
            .toLowerCase()
            .match(/\b\w+\b/g) || [];
    const positive = ['good', 'great', 'excellent', 'amazing', 'useful', 'helpful', 'interesting', 'love'];
    const negative = ['bad', 'poor', 'boring', 'terrible', 'late', 'waste', 'disappointing', 'slow'];
    let score = 0;
    for (const word of words) {
        if (positive.includes(word)) score++;
        if (negative.includes(word)) score--;
    }
    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

async function notify(user, message) {
    return Notification.create({ user, message });
}

async function notifyAttendees(event, message) {
    const users = await Registration.distinct('user', {
        event: event._id,
        status: { $in: ['registered', 'waitlisted', 'checked-in'] },
    });
    await Notification.insertMany(users.map((user) => ({ user, message })));
}

async function sendReminders() {
    const now = new Date();
    const events = await Event.find({ status: 'approved', start: { $gt: now, $lte: new Date(+now + 86400000) } });
    for (const event of events) {
        const registrations = await Registration.find({ event: event._id, status: 'registered', reminderSent: false });
        for (const registration of registrations) {
            const user = await User.findById(registration.user);
            if (!user?.active || !user.preferences.reminders) continue;
            const claimed = await Registration.findOneAndUpdate(
                { _id: registration._id, reminderSent: false },
                { reminderSent: true },
            );
            if (claimed) await notify(user._id, `Reminder: ${event.title} starts at ${event.start.toLocaleString()}.`);
        }
    }
}

module.exports = {
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
};
