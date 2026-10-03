const mongoose = require('mongoose');
const { Schema } = mongoose;

const categories = ['Academic', 'Cultural', 'Sports', 'Social', 'Workshop', 'Seminar'];
const statuses = ['registered', 'waitlisted', 'checked-in', 'cancelled', 'no-show'];
const reference = (model) => ({ type: Schema.Types.ObjectId, ref: model, required: true });
const integer = (minimum) => ({ type: Number, min: minimum, validate: Number.isInteger, required: true });
const rating = { ...integer(1), max: 5 };

const userSchema = new Schema(
    {
        name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, select: false },
        phone: { type: String, default: '' },
        interests: [String],
        preferences: { reminders: { type: Boolean, default: true }, connect: { type: Boolean, default: false } },
        role: { type: String, enum: ['admin', 'organizer', 'student'], default: 'student' },
        organizationRegistrationNumber: { type: String, default: '' },
        verified: { type: Boolean, default: false },
        emailVerified: { type: Boolean, default: false },
        verificationToken: { type: String, select: false },
        verificationExpires: { type: Date, select: false },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
);

const venueSchema = new Schema(
    {
        name: { type: String, required: true, unique: true, trim: true },
        location: { type: String, required: true, trim: true },
        capacity: integer(1),
        amenities: [String],
        images: [String],
        archived: { type: Boolean, default: false },
        bookingVersion: { type: Number, default: 0 },
    },
    { timestamps: true },
);

const eventSchema = new Schema(
    {
        title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
        description: { type: String, required: true, minlength: 50 },
        category: { type: String, enum: categories, required: true },
        start: { type: Date, required: true },
        end: { type: Date, required: true },
        day: { type: String, required: true },
        venue: reference('Venue'),
        organizer: reference('User'),
        capacity: integer(1),
        registered: { type: Number, default: 0, min: 0 },
        budget: { type: Number, default: 0, min: 0 },
        breakdown: [{ label: String, amount: { type: Number, min: 0 } }],
        poster: { type: String, default: '' },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'cancelled', 'archived'],
            default: 'pending',
        },
        views: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
        traffic: [
            {
                source: String,
                views: { type: Number, default: 0 },
                clicks: { type: Number, default: 0 },
                registrations: { type: Number, default: 0 },
            },
        ],
        review: {
            rating: { type: Number, min: 1, max: 5, validate: Number.isInteger },
            compliance: String,
            strengths: String,
            improvements: String,
        },
        reviewReason: { type: String, default: '' },
    },
    { timestamps: true },
);
eventSchema.index({ organizer: 1, day: 1, title: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const registrationSchema = new Schema(
    {
        user: reference('User'),
        event: reference('Event'),
        status: { type: String, enum: statuses, default: 'registered' },
        qrCode: { type: String, required: true, unique: true },
        source: { type: String, default: 'direct' },
        checkedInAt: Date,
        reminderSent: { type: Boolean, default: false },
    },
    { timestamps: true },
);
registrationSchema.index({ user: 1, event: 1 }, { unique: true });

const feedbackSchema = new Schema(
    {
        user: reference('User'),
        event: reference('Event'),
        rating,
        quality: rating,
        organization: rating,
        venueSuitability: rating,
        relevance: rating,
        value: rating,
        comment: { type: String, maxlength: 1000, default: '' },
        sentiment: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
        response: { type: String, maxlength: 1000, default: '' },
    },
    { timestamps: true },
);
feedbackSchema.index({ user: 1, event: 1 }, { unique: true });

const notificationSchema = new Schema(
    {
        user: reference('User'),
        message: { type: String, required: true },
        read: { type: Boolean, default: false },
        archived: { type: Boolean, default: false },
    },
    { timestamps: true },
);

const suggestionSchema = new Schema(
    {
        user: reference('User'),
        type: { type: String, enum: ['suggestion', 'bug', 'feedback'], required: true },
        title: { type: String, required: true, minlength: 2, maxlength: 200 },
        details: { type: String, required: true, minlength: 10, maxlength: 3000 },
        screenshot: String,
        status: {
            type: String,
            enum: ['submitted', 'planned', 'in-progress', 'implemented', 'declined'],
            default: 'submitted',
        },
        response: { type: String, maxlength: 1000, default: '' },
    },
    { timestamps: true },
);

const activitySchema = new Schema({ user: reference('User'), action: String }, { timestamps: true });

module.exports = {
    categories,
    statuses,
    User: mongoose.model('User', userSchema),
    Venue: mongoose.model('Venue', venueSchema),
    Event: mongoose.model('Event', eventSchema),
    Registration: mongoose.model('Registration', registrationSchema),
    Feedback: mongoose.model('Feedback', feedbackSchema),
    Notification: mongoose.model('Notification', notificationSchema),
    Suggestion: mongoose.model('Suggestion', suggestionSchema),
    Activity: mongoose.model('Activity', activitySchema),
};
