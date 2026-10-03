require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const { User, Venue, Event, Registration, Feedback } = require('./models');
const { hashPassword } = require('./helpers');

async function seedDemo() {
    const accounts = [
        {
            name: 'Alex Morgan',
            email: 'organizer@campus.example',
            role: 'organizer',
            organizationRegistrationNumber: 'COLLEGE-CLUB-001',
        },
        { name: 'Sam Taylor', email: 'student@campus.example', role: 'student' },
    ];
    const users = [];
    for (const account of accounts) {
        users.push(
            await User.findOneAndUpdate(
                { email: account.email },
                {
                    $setOnInsert: {
                        ...account,
                        password: hashPassword('CampusDemo123!'),
                        phone: '+919876543210',
                        interests: ['Workshop', 'Cultural'],
                        verified: true,
                        emailVerified: true,
                    },
                },
                { upsert: true, new: true },
            ),
        );
    }
    const spaces = [
        {
            name: 'Innovation Studio',
            location: 'North Campus, Block A',
            capacity: 80,
            amenities: ['Projector', 'Wi-Fi', 'Air conditioning'],
        },
        {
            name: 'Open Air Theatre',
            location: 'Central Campus',
            capacity: 300,
            amenities: ['Stage', 'Sound system', 'Accessible seating'],
        },
        {
            name: 'Sports Arena',
            location: 'East Campus',
            capacity: 200,
            amenities: ['Changing rooms', 'First aid', 'Parking'],
        },
    ];
    const venues = [];
    for (const space of spaces)
        venues.push(
            await Venue.findOneAndUpdate({ name: space.name }, { $setOnInsert: space }, { upsert: true, new: true }),
        );
    /** @type {Array<[string, string, number, number, string]>} */
    const samples = [
        [
            'Design thinking lab',
            'Workshop',
            0,
            2,
            'Turn everyday problems into creative solutions in a hands-on design thinking session. Bring your curiosity; we will bring the sticky notes and a fresh perspective.',
        ],
        [
            'Campus under the stars',
            'Cultural',
            1,
            5,
            'An evening of live music, student performances, and stories that bring our campus together. Join friends old and new for an unforgettable celebration of creativity.',
        ],
        [
            'The campus cup',
            'Sports',
            2,
            8,
            'Cheer for your department at our friendly inter-college sports meet. Enjoy exciting matches, team spirit, and a day dedicated to healthy competition and community.',
        ],
        [
            'Ideas worth sharing',
            'Seminar',
            0,
            12,
            'Meet inspiring alumni and explore how small ideas grow into meaningful projects. Ask questions, share your ambitions, and discover your next step beyond the classroom.',
        ],
        [
            'Community coffee morning',
            'Social',
            1,
            15,
            'Start your weekend with meaningful conversations and new connections. A relaxed morning for students from every department to meet, collaborate, and feel at home.',
        ],
        [
            'Research made simple',
            'Academic',
            0,
            19,
            'Learn the essentials of research planning, reading papers, and presenting your findings. This practical session is designed for students beginning their first academic project.',
        ],
        [
            'Creative coding recap',
            'Workshop',
            0,
            -3,
            'A completed hands-on introduction to creative coding, collaborative projects, and practical problem solving. This past event demonstrates attendance, feedback, and event history.',
        ],
    ];
    let past;
    for (const [title, category, venueIndex, days, description] of samples) {
        const start = new Date(Date.now() + days * 86400000);
        start.setHours(14, 0, 0, 0);
        const event = await Event.findOneAndUpdate(
            { title, organizer: users[0]._id },
            {
                $setOnInsert: {
                    title,
                    category,
                    description,
                    start,
                    end: new Date(+start + 7200000),
                    day: start.toISOString().slice(0, 10),
                    venue: venues[venueIndex]._id,
                    organizer: users[0]._id,
                    capacity: venues[venueIndex].capacity,
                    budget: 2000,
                    status: 'approved',
                },
            },
            { upsert: true, new: true },
        );
        if (days < 0) past = event;
    }
    if (past && !(await Registration.exists({ user: users[1]._id, event: past._id }))) {
        await Registration.create({
            user: users[1]._id,
            event: past._id,
            status: 'checked-in',
            qrCode: crypto.randomUUID(),
            checkedInAt: past.start,
        });
        await Event.updateOne({ _id: past._id }, { $inc: { registered: 1 } });
        await Feedback.create({
            user: users[1]._id,
            event: past._id,
            rating: 5,
            quality: 5,
            organization: 4,
            venueSuitability: 5,
            relevance: 5,
            value: 5,
            comment: 'Great workshop with useful examples. More time for questions would be helpful.',
            sentiment: 'positive',
        });
    }
}

if (require.main === module) {
    if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
    mongoose
        .connect(process.env.MONGO_URI)
        .then(seedDemo)
        .then(() => {
            console.log('Demo data added. Existing records were not reset.');
            return mongoose.disconnect();
        })
        .catch(() => {
            console.error('Seed failed. Check your local database configuration.');
            process.exitCode = 1;
        });
}
module.exports = { seedDemo };
