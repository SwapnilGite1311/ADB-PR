# Quick presentation: website + MongoDB Compass

## Start

1. Install Node.js 24 LTS. Extract this ZIP directly into your ADB PR folder (keep a backup).
2. Double-click `start-demo.cmd`. On first use it installs packages and downloads MongoDB, so allow a few minutes and keep internet connected.
3. Wait for **Local demo ready**, keep that window open, and open http://localhost:3000 in your PC browser. No separate frontend process is needed.
4. Open MongoDB Compass and connect:

```text
mongodb://127.0.0.1:27018/college_events_demo?replicaSet=campusDemo
```

5. Open **college_events_demo**. Keep Compass and the website side by side. Make changes in the website, then Refresh Compass.

## Fixed logins

All passwords: **CampusDemo123!**. The login screen has buttons to fill these in.

| Role      | Email                    |
| --------- | ------------------------ |
| Admin     | admin@campus.example     |
| Organizer | organizer@campus.example |
| Student   | student@campus.example   |

Log out before switching accounts. Passwords in `users` are hashes; never paste the hash into the login form. Restarting demo restores these three logins only, preserving new users and application data.

## Show these in order

| #   | Website steps                                                                                                                                                                       | Compass proof                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Log out → Create an account → register a student with a unique email, valid phone and an 8+ character password. Open the displayed confirmation link, then log in.                  | `users`: a new student appears immediately, `emailVerified` changes from false to true after confirmation.                     |
| 2   | Log in as admin → Dashboard → Create user. Create another student (or organizer with a registration number).                                                                        | `users`: new document, role and `emailVerified: true`; password is a hash.                                                     |
| 3   | Admin → Edit / reset password on that new user → change their name and optionally password.                                                                                         | `users`: same `_id`, updated name; new password logs in.                                                                       |
| 4   | Admin → Venues → add a hall, then edit its capacity. Use valid capacity such as 20.                                                                                                 | `venues`: new document, then same `_id` with changed capacity.                                                                 |
| 5   | Admin → Dashboard → Create an event → choose Alex Morgan, your new hall, a start tomorrow, end two hours later, capacity 2 and a description of 50+ characters. Save, then Approve. | `events`: new document, organizer/venue references; status pending → approved.                                                 |
| 6   | Organizer → Dashboard → edit this event's title. Admin then approves it again.                                                                                                      | `events`: same `_id`, changed title; pending → approved.                                                                       |
| 7   | Student → open the event → reserve a seat → Dashboard → show QR ticket.                                                                                                             | `registrations`: document with user/event IDs, status registered; `events.registered` increases.                               |
| 8   | Student → cancel the RSVP.                                                                                                                                                          | `registrations.status: cancelled`; allocated seat count decreases. Cancellation preserves history.                             |
| 9   | Student → Dashboard → Creative coding recap → edit existing feedback, delete it, add feedback again, and change its comment. Fill all six ratings.                                  | `feedbacks`: same ID updated → document removed → new document → same new ID updated. This demonstrates permanent-delete CRUD. |
| 10  | Organizer → Creative coding recap → respond to the student's feedback.                                                                                                              | `feedbacks.response` changes and a student `notifications` document appears.                                                   |
| 11  | Admin → Reports & insights → CSV or JSON export; Suggestions → update implementation status after a student submits a suggestion.                                                   | Compare report totals with collections; `suggestions.status` changes.                                                          |
| 12  | Admin → archive an unused demonstration venue; deactivate a new student with no upcoming RSVPs.                                                                                     | `venues.archived: true` and `users.active: false`. These are soft deletes, not physical removal.                               |

For a waitlist demonstration, create/approve a one-seat event, register two students, then cancel the first student's RSVP. Compass shows the second student moving from `waitlisted` to `registered`.

Live check-in needs the event to have started; feedback/no-show needs it to have ended. Use the completed sample event for immediate feedback. Events cannot overlap in the same venue, exceed venue capacity, have a duration below one hour or a short description.

## Stop / troubleshooting

Press Ctrl+C to stop. Do not close the server window during the presentation. Normal shutdown preserves `.demo-data`; deleting that folder deletes your local demo records. If the server stops unexpectedly, the launcher pauses with the exit message and writes `demo-log.txt`; share both. This package has been verified on Linux, not on your Windows machine, so an external Windows termination cause remains unconfirmed.
