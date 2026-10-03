const { User, Venue, Event, Registration, Feedback, Suggestion, Activity } = require('./models');

const average = (numbers) =>
    numbers.length ? Number((numbers.reduce((sum, number) => sum + number, 0) / numbers.length).toFixed(2)) : 0;
const percent = (part, total) => (total ? Number(((part * 100) / total).toFixed(1)) : 0);

function groups(items, key) {
    const counts = Object.create(null);
    for (const item of items) {
        const label = key(item) || 'Unknown';
        counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
}

function themes(feedback) {
    const stopWords = [
        'this',
        'that',
        'with',
        'from',
        'were',
        'have',
        'very',
        'event',
        'overall',
        'there',
        'would',
        'could',
        'should',
        'about',
        'they',
        'their',
    ];
    const words = feedback.flatMap((item) =>
        (item.comment.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter((word) => !stopWords.includes(word)),
    );
    return groups(words, (word) => word).slice(0, 8);
}

async function buildReport(user) {
    const eventFilter = user.role === 'organizer' ? { organizer: user._id } : {};
    /** @type {any[]} */
    const events = await Event.find(eventFilter).populate('venue', 'name').populate('organizer', 'name').lean();
    const eventIds = events.map((event) => event._id);
    const registrationFilter = user.role === 'student' ? { user: user._id } : { event: { $in: eventIds } };
    /** @type {any[]} */
    const registrations = await Registration.find(registrationFilter).populate('user', 'name email interests').lean();
    /** @type {any[]} */
    const feedback = await Feedback.find(user.role === 'student' ? { user: user._id } : { event: { $in: eventIds } })
        .populate('user', 'name')
        .lean();
    /** @type {{role: string, generatedAt: Date, tables: Record<string, any[]>, metrics: Record<string, number>, recommendations?: any[]}} */
    const report = { role: user.role, generatedAt: new Date(), tables: {}, metrics: {} };
    const eventById = Object.fromEntries(events.map((event) => [String(event._id), event]));

    if (user.role === 'student') {
        report.metrics = {
            'My registrations': registrations.length,
            Attended: registrations.filter((item) => item.status === 'checked-in').length,
            'Feedback submitted': feedback.length,
        };
        report.tables['My events and history'] = registrations.map((item) => {
            const event = eventById[String(item.event)];
            return {
                event: event?.title || 'Removed event',
                date: event?.start,
                status: item.status,
                eventStatus: event?.status,
                venue: event?.venue?.name,
            };
        });
        report.tables['My feedback'] = feedback.map((item) => ({
            event: eventById[String(item.event)]?.title,
            rating: item.rating,
            comment: item.comment,
            response: item.response,
        }));
        const joinedIds = registrations.filter((item) => item.status !== 'cancelled').map((item) => String(item.event));
        const interests = user.interests.map((item) => item.toLowerCase());
        const historyCategories = registrations
            .filter((item) => item.status === 'checked-in')
            .map((item) => eventById[String(item.event)]?.category);
        const recommendations = events.filter(
            (event) =>
                event.status === 'approved' && event.start > new Date() && !joinedIds.includes(String(event._id)),
        );
        const score = (event) =>
            (interests.some((interest) => `${event.category} ${event.title}`.toLowerCase().includes(interest))
                ? 3
                : 0) + historyCategories.filter((category) => category === event.category).length;
        report.recommendations = recommendations.sort((a, b) => score(b) - score(a) || +a.start - +b.start).slice(0, 6);
        return report;
    }

    const eventRows = events.map((event) => {
        const attendees = registrations.filter((item) => String(item.event) === String(event._id));
        const reviews = feedback.filter((item) => String(item.event) === String(event._id));
        const count = (status) => attendees.filter((item) => item.status === status).length;
        const allocated = count('registered') + count('checked-in') + count('no-show');
        return {
            event: event.title,
            status: event.status,
            date: event.start,
            registered: count('registered'),
            attended: count('checked-in'),
            noShows: count('no-show'),
            cancellations: count('cancelled'),
            waitlisted: count('waitlisted'),
            attendanceRate: percent(count('checked-in'), allocated),
            noShowPercent: percent(count('no-show'), allocated),
            averageRating: average(reviews.map((item) => item.rating)),
            views: event.views,
            clicks: event.clicks,
            venue: event.venue?.name,
            organizer: event.organizer?.name,
            budget: event.budget,
        };
    });
    const attended = registrations.filter((item) => item.status === 'checked-in').length;
    const allocated = registrations.filter((item) =>
        ['registered', 'checked-in', 'no-show'].includes(item.status),
    ).length;
    report.metrics = {
        'Total events': events.length,
        'Active events': events.filter((event) => event.status === 'approved' && event.end > new Date()).length,
        'Cancelled events': events.filter((event) => event.status === 'cancelled').length,
        'Attendance %': percent(attended, allocated),
        'No-show %': percent(registrations.filter((item) => item.status === 'no-show').length, allocated),
        'Average rating': average(feedback.map((item) => item.rating)),
    };
    report.tables['Event analytics'] = eventRows;
    report.tables['Attendee report'] = registrations.map((item) => ({
        event: eventById[String(item.event)]?.title,
        student: item.user?.name,
        email: item.user?.email,
        status: item.status,
        source: item.source,
        checkedIn: item.checkedInAt,
    }));
    report.tables['Feedback analysis'] = feedback.map((item) => ({
        event: eventById[String(item.event)]?.title,
        student: item.user?.name,
        rating: item.rating,
        quality: item.quality,
        organization: item.organization,
        venue: item.venueSuitability,
        relevance: item.relevance,
        value: item.value,
        sentiment: item.sentiment,
        comment: item.comment,
        response: item.response,
        date: item.createdAt,
    }));
    report.tables['Common feedback themes (word counts)'] = themes(feedback);
    report.tables['Feedback sentiment'] = groups(feedback, (item) => item.sentiment);
    report.tables['Feedback trends'] = groups(
        feedback,
        (item) => `${item.createdAt.toISOString().slice(0, 7)} · ${item.sentiment}`,
    );
    report.tables['Peak check-in hours (UTC)'] = groups(
        registrations.filter((item) => item.checkedInAt),
        (item) => `${item.checkedInAt.getUTCHours()}:00`,
    );
    report.tables['Promotion effectiveness'] = events.flatMap((event) =>
        event.traffic.map((item) => ({
            event: event.title,
            source: item.source,
            views: item.views,
            clicks: item.clicks,
            registrations: item.registrations,
            conversionPercent: percent(item.registrations, item.views),
        })),
    );
    report.tables['Admin execution feedback'] = events
        .filter((event) => event.review?.rating)
        .map((event) => ({
            event: event.title,
            rating: event.review.rating,
            compliance: event.review.compliance,
            strengths: event.review.strengths,
            improvements: event.review.improvements,
        }));

    if (user.role === 'admin') {
        const users = await User.find().lean();
        const venues = await Venue.find().lean();
        /** @type {any[]} */
        const activity = await Activity.find().populate('user', 'name').lean();
        const suggestions = await Suggestion.find().lean();
        report.metrics['Total users'] = users.length;
        report.metrics['Active users'] = users.filter((item) => item.active).length;
        report.tables['Trending events'] = [...eventRows]
            .sort((a, b) => b.registered + b.attended + b.noShows - (a.registered + a.attended + a.noShows))
            .slice(0, 5);
        report.tables['Student engagement'] = users
            .filter((item) => item.role === 'student')
            .map((student) => {
                const joined = registrations.filter((item) => String(item.user?._id) === String(student._id));
                return {
                    student: student.name,
                    interests: student.interests.join(', '),
                    participation: joined.filter((item) => item.status !== 'cancelled').length,
                    attended: joined.filter((item) => item.status === 'checked-in').length,
                };
            });
        report.tables['Student interests'] = groups(
            users.filter((item) => item.role === 'student').flatMap((item) => item.interests),
            (item) => item,
        );
        report.tables['Organizer performance'] = users
            .filter((item) => item.role === 'organizer')
            .map((organizer) => {
                const ownEvents = events.filter((event) => String(event.organizer?._id) === String(organizer._id));
                const ownIds = ownEvents.map((event) => String(event._id));
                return {
                    organizer: organizer.name,
                    verified: organizer.verified,
                    active: organizer.active,
                    eventsCreated: ownEvents.length,
                    approvalPercent: percent(
                        ownEvents.filter((event) => event.status === 'approved').length,
                        ownEvents.length,
                    ),
                    averageRating: average(
                        feedback.filter((item) => ownIds.includes(String(item.event))).map((item) => item.rating),
                    ),
                    compliance: ownEvents
                        .map((event) => event.review?.compliance)
                        .filter(Boolean)
                        .join('; '),
                };
            });
        report.tables['Venue utilization'] = venues.map((venue) => {
            const booked = events.filter(
                (event) => String(event.venue?._id) === String(venue._id) && event.status === 'approved',
            );
            return {
                venue: venue.name,
                capacity: venue.capacity,
                bookings: booked.length,
                bookedHours: Number(
                    booked.reduce((sum, event) => sum + (+event.end - +event.start) / 3600000, 0).toFixed(1),
                ),
                seatUtilizationPercent: percent(
                    booked.reduce((sum, event) => sum + event.registered, 0),
                    booked.reduce((sum, event) => sum + event.capacity, 0),
                ),
            };
        });
        report.tables['Booking trends'] = groups(events, (item) => item.start.toISOString().slice(0, 7));
        report.tables['System activity'] = activity.map((item) => ({
            user: item.user?.name,
            action: item.action,
            date: item.createdAt,
        }));
        report.tables['Login trends'] = groups(
            activity.filter((item) => item.action === 'login'),
            (item) => item.createdAt.toISOString().slice(0, 10),
        );
        report.tables['User registration trends'] = groups(users, (item) => item.createdAt.toISOString().slice(0, 10));
        report.tables['Platform submission statuses'] = groups(suggestions, (item) => item.status);
        report.tables['Platform submission trends'] = groups(
            suggestions,
            (item) => `${item.createdAt.toISOString().slice(0, 7)} · ${item.type}`,
        );
        report.tables['Platform common themes (word counts)'] = themes(
            suggestions.map((item) => ({ comment: item.details })),
        );
    }
    return report;
}

module.exports = { average, percent, groups, themes, buildReport };
