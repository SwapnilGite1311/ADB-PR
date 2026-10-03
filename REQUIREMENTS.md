# PDF coverage checklist

The supplied PDF is retained as `Assignment_4986_Content_Document_20260923101822250AM.pdf`.

| PDF area | Implemented workflow | Main code |
| --- | --- | --- |
| User CRUD | Signup, confirmed email, login/logout, profile/interests/preferences, deactivation, admin activation and organizer verification | `models.js`, auth/profile/admin-user routes in `server.js` |
| Event CRUD | Create, details, edit/reschedule, approval/rejection, cancellation, archive, poster and Markdown | `eventInput` in `helpers.js`; event routes in `server.js` |
| Registration CRUD | RSVP, unique registration per student/event, status and QR ticket, waitlist, promotion, cancellation, check-in and no-show | registration routes in `server.js` |
| Venue CRUD | Location, capacity, amenities, images, current bookings, editing and archive | venue routes; `venues` in `public/app.js` |
| Feedback CRUD | Post-event checked-in-only feedback, six ratings, comments, sentiment, editing, deletion and organizer response | feedback routes and event detail UI |
| Notification CRUD | Automatic/manual notifications, history, mark read, archive, clear read/archived, reminders | `notify`, `notifyAttendees`, `sendReminders`; notification routes |
| Email, phone, password | Normalized unique email, one-time confirmation link, phone pattern, salted password hashes | `accountInput`, `hashPassword`, `checkPassword`; auth routes |
| Event title and category | 2–200 characters, unique per organizer/UTC date (case insensitive); six prescribed categories | event schema/index; `eventInput` |
| Event description and time | 50-character minimum, sanitized Markdown, future start, at least one-hour duration | `eventInput`; event detail route |
| Capacity and availability | Positive integer, event ≤ venue capacity, atomic seat allocation, serialized conflicting venue bookings | validation plus MongoDB transactions |
| Status and rating validation | Five prescribed registration statuses; integer ratings 1–5, comments ≤1000 characters | schemas and attendance/feedback routes |
| Image validation | Actual JPG/PNG content, ≤5 MB, compressed and resized; private screenshots | upload and screenshot routes |
| Organizer and budget validation | Admin-verified organization registration number; nonnegative budget; configured threshold and matching breakdown | admin-user routes; `eventInput` |
| Admin permissions | All-event moderation, users, venues, execution evaluation, policy checks, health status and report exports | `requireRole`, dashboard, reports |
| Organizer permissions | Own events only, attendee list, check-ins/no-shows, student responses, promotion links, own reports | `managedEvent`, organizer dashboard |
| Student permissions | Browse/filter, RSVP and schedule, notifications, feedback, organizer info, opted-in attendee connections | student dashboard, detail page and profile |
| Admin event/attendance reports | Total/active/cancelled/trending events; attendance/no-show percentages; peak check-in hours | `reports.js` |
| Admin engagement/performance reports | Participation, interests, organizer event counts/approval rates/ratings/compliance | `reports.js` |
| Admin venue/system reports | Booking hours, seat utilization, booking trends, signup/login activity, database health/uptime | `reports.js`; health route |
| Organizer reports | Event statistics, attendees/cancellations, six-dimension ratings, sentiment/themes/trends, traffic-source views/clicks/registrations | `reports.js` |
| Student reports | Registrations, upcoming/past history, submitted ratings/responses, interest/history-based recommendations | `buildReport` student branch |
| Student event feedback | Quality, organization, venue suitability, relevance, value, overall rating and improvement text | feedback schema, detail form |
| Organizer feedback from admin | Execution rating, compliance/guidelines, strengths/attendee satisfaction, improvements/future recommendations | evaluation route and form |
| Platform suggestions and bugs | All-role submissions, issue details, private screenshots, admin response and implementation status | suggestion/upload routes; `help` UI |
| Platform feedback trends | Submission status, monthly type trends, common word themes | admin report tables |
| Exports | CSV per report table and complete JSON report | `downloadCSV`, `downloadReport` in `public/app.js` |

## Interpretations, not extra PDF facts

The budget threshold (10000), approval workflow, UTC date uniqueness, manual organization verification, in-app reminders, public demo mode, simple word-based sentiment, and scoring-based recommendations are explicit implementation choices where the PDF leaves behavior open. “Success rate” is reported as organizer event approval percentage. “Peak attendance hours” is reported as UTC check-in-hour counts. Registration limits count registered/checked-in/no-show seats, not waitlisted/cancelled requests.

## Verification scope

Automated tests run against a real disposable MongoDB replica set and cover validation, roles/ownership, email confirmation, concurrent venue bookings and seat allocation, waitlist promotion, QR check-in, feedback, notifications/reminders, upload privacy/size, reporting, cancellation/archive, and repeatable demo seeding. SMTP delivery and Windows-specific execution were not tested. Browser-driven testing is separate and requires user approval.
