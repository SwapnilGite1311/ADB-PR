let me = null;
let config = {};
let currentEvents = [];
let currentVenues = [];
let currentUsers = [];
let currentReport = null;
let eventSource = 'direct';
let toastTimer;
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
const date = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const tag = (text) => /* HTML */ `
    <span class="tag ${esc(text)}">${esc(text)}</span>
`;
const empty = (title, text = '') => /* HTML */ `
    <div class="empty">
        <strong>${esc(title)}</strong>
        ${esc(text)}
    </div>
`;
const heading = (title, subtitle, action = '') => /* HTML */ `
    <div class="page-heading">
        <div>
            <span class="eyebrow">Your campus, connected</span>
            <h1>${esc(title)}</h1>
            <p>${esc(subtitle)}</p>
        </div>
        ${action}
    </div>
`;
const options = (items, selected) =>
    items
        .map(
            (item) => /* HTML */ `
                <option value="${esc(item)}" ${item === selected ? 'selected' : ''}>${esc(item)}</option>
            `,
        )
        .join('');

function toast(message, bad = false) {
    $('#toast').textContent = message;
    $('#toast').className = bad ? 'show bad' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        $('#toast').className = '';
    }, 4500);
}

async function api(url, method = 'GET', body) {
    const isFile = body instanceof FormData;
    const response = await fetch('/api' + url, {
        method,
        headers: body && !isFile ? { 'Content-Type': 'application/json' } : {},
        body: body ? (isFile ? body : JSON.stringify(body)) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to complete this request.');
    return data;
}

async function run(action) {
    try {
        await action();
    } catch (error) {
        toast(error.message || 'Connection failed. Is the server running?', true);
    }
}

async function submit(event, action) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    await run(() => action(Object.fromEntries(new FormData(form)), form));
    button.disabled = false;
}

function field(name, label, type = 'text', value = '', attrs = '') {
    const input =
        type === 'textarea'
            ? /* HTML */ `
                  <textarea id="${name}" name="${name}" ${attrs}>${esc(value)}</textarea>
              `
            : /* HTML */ `
                  <input
                      id="${name}"
                      name="${name}"
                      type="${type}"
                      value="${type === 'file' ? '' : esc(value)}"
                      ${attrs}
                  />
              `;
    return /* HTML */ `
        <div class="field">
            <label for="${name}">${label}</label>
            ${input}
        </div>
    `;
}

function select(name, label, values, selected) {
    return /* HTML */ `
        <div class="field">
            <label for="${name}">${label}</label>
            <select id="${name}" name="${name}">
                ${options(values, selected)}
            </select>
        </div>
    `;
}

function table(rows, columns) {
    if (!rows.length) return empty('Nothing here yet', 'New activity will appear here.');
    const keys = columns || Object.keys(rows[0]);
    return /* HTML */ `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        ${keys
                            .map(
                                (key) => /* HTML */ `
                                    <th>${esc(key.replace(/([A-Z])/g, ' $1'))}</th>
                                `,
                            )
                            .join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows
                        .map(
                            (row) => /* HTML */ `
                                <tr>
                                    ${keys
                                        .map(
                                            (key) => /* HTML */ `
                                                <td>
                                                    ${esc(
                                                        row[key] instanceof Object
                                                            ? JSON.stringify(row[key])
                                                            : (row[key] ?? '—'),
                                                    )}
                                                </td>
                                            `,
                                        )
                                        .join('')}
                                </tr>
                            `,
                        )
                        .join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openModal(title, content) {
    $('#modal-content').innerHTML = /* HTML */ `
        <div class="modal-head">
            <h2>${esc(title)}</h2>
            <button class="ghost small" aria-label="Close dialog" onclick="closeModal()">Close</button>
        </div>
        ${content}
    `;
    if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() {
    $('#modal').close();
}

function renderNavigation() {
    const page = location.hash.slice(1).split('/')[0] || 'events';
    const links = [
        ['events', 'Discover events'],
        ...(me
            ? [
                  ['dashboard', 'My dashboard'],
                  ...(me.role === 'admin' ? [['venues', 'Venues']] : []),
                  ['reports', 'Reports & insights'],
                  ['notifications', 'Notifications'],
                  ['profile', 'My profile'],
                  ['help', 'Feedback & ideas'],
              ]
            : [
                  ['login', 'Log in'],
                  ['signup', 'Create account'],
              ]),
    ];
    const paths = [
        'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
        'M4 19V5h16v14zM4 9h16M8 3v4M16 3v4',
        'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16V5',
    ];
    $('#nav').innerHTML = links
        .map(
            ([key, text], index) => /* HTML */ `
                <a href="#${key}" class="${page === key ? 'active' : ''}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[index % paths.length]}" /></svg>
                    ${text}
                </a>
            `,
        )
        .join('');
    $('#breadcrumb').textContent = 'Campus / ' + (links.find((item) => item[0] === page)?.[1] || 'Event details');
    $('#account').innerHTML = me
        ? /* HTML */ `
              <span class="avatar">${esc(me.name.slice(0, 1).toUpperCase())}</span>
              <div>
                  ${esc(me.name)}
                  <div class="role">${esc(me.role)}</div>
              </div>
              <button class="ghost small" onclick="logout()">Log out</button>
          `
        : /* HTML */ `
              <a href="#login">Log in</a>
              <button class="small" onclick="location.hash='signup'">Join campus</button>
          `;
}

async function route() {
    renderNavigation();
    const [path, query] = (location.hash.slice(1) || 'events').split('?');
    const [page, id] = path.split('/');
    eventSource = new URLSearchParams(query).get('source') || 'direct';
    const routes = { events: browse, detail, login, signup, dashboard, venues, reports, notifications, profile, help };
    if (!me && !['events', 'detail', 'login', 'signup'].includes(page)) return login();
    $('#app').innerHTML = empty('Loading…');
    window.scrollTo(0, 0);
    try {
        await (routes[page] || browse)(id);
    } catch (error) {
        $('#app').innerHTML = empty('Unable to load this page', error.message);
        toast(error.message, true);
    }
}

function login() {
    $('#app').innerHTML = /* HTML */ `
        <section class="panel auth">
            <span class="eyebrow">Welcome back</span>
            <h1>Your campus is waiting.</h1>
            <p>Log in to manage your next campus moment.</p>
            ${location.search.includes('verified=1')
                ? '<div class="notice">Email confirmed. You can now log in.</div>'
                : ''}
            <form onsubmit="signIn(event)">
                ${field('email', 'Email address', 'email', '', 'required autocomplete="email"')}${field(
                    'password',
                    'Password',
                    'password',
                    '',
                    'required autocomplete="current-password"',
                )}
                <button type="submit">Log in</button>
            </form>
            <div class="auth-links">
                New here?
                <a href="#signup">Create an account</a>
            </div>
            ${config.demoUsers?.length
                ? /* HTML */ `
                      <div class="notice">
                          <b>Fixed demo logins</b>
                          <p>Password for all three: ${esc(config.demoPassword)}</p>
                          <div class="actions">
                              ${config.demoUsers
                                  .map(
                                      (user) => /* HTML */ `
                                          <button class="ghost small" onclick="fillDemoLogin('${esc(user.role)}')">
                                              ${esc(user.role)}
                                          </button>
                                      `,
                                  )
                                  .join('')}
                          </div>
                          <p>Pick a role to fill the form, then click Log in.</p>
                      </div>
                  `
                : ''}
        </section>
    `;
}
function signIn(event) {
    return submit(event, async (data) => {
        me = await api('/auth/login', 'POST', data);
        location.hash = 'dashboard';
    });
}
function fillDemoLogin(role) {
    const user = config.demoUsers.find((item) => item.role === role);
    if (!user) return;
    $('#email').value = user.email;
    $('#password').value = config.demoPassword;
}
function signup() {
    $('#app').innerHTML = /* HTML */ `
        <section class="panel auth">
            <span class="eyebrow">Make yourself at home</span>
            <h1>Join your campus.</h1>
            <p>Discover something new. Meet your people.</p>
            <form onsubmit="signUp(event)">
                ${field(
                    'name',
                    'Full name',
                    'text',
                    '',
                    'required minlength="2" maxlength="100" autocomplete="name"',
                )}${field('email', 'Email address', 'email', '', 'required autocomplete="email"')}${field(
                    'phone',
                    'Phone (10–15 digits, optional + prefix)',
                    'tel',
                    '',
                    'required pattern="[+]?[0-9]{10,15}" autocomplete="tel"',
                )}${field(
                    'password',
                    'Password (at least 8 characters)',
                    'password',
                    '',
                    'required minlength="8" maxlength="128" autocomplete="new-password"',
                )}${select('role', 'I am a', ['student', 'organizer'], 'student')}${field(
                    'orgRegNo',
                    'Organization registration number (organizers only)',
                )}${field(
                    'interests',
                    'Interests (comma separated)',
                    'text',
                    '',
                    'placeholder="Workshop, Sports, coding"',
                )}
                <button type="submit">Create account</button>
            </form>
            <div id="confirmation"></div>
            <div class="auth-links">
                Already a member?
                <a href="#login">Log in</a>
            </div>
        </section>
    `;
}
function signUp(event) {
    return submit(event, async (data) => {
        const result = await api('/auth/register', 'POST', data);
        $('#confirmation').innerHTML = /* HTML */ `
            <div class="notice">
                ${esc(result.message)}${result.verificationUrl
                    ? /* HTML */ `
                          <br />
                          <a href="${esc(result.verificationUrl)}">Confirm my email</a>
                          <br />
                          <small>Local demonstration link; production uses email.</small>
                      `
                    : ''}
            </div>
        `;
        event.target.reset();
        toast('Account created. Confirm your email next.');
    });
}
function logout() {
    return run(async () => {
        await api('/auth/logout', 'POST');
        me = null;
        location.hash = 'events';
        await route();
    });
}

async function browse() {
    const today = new Date();
    $('#app').innerHTML = /* HTML */ `
        <section class="hero">
            <div>
                <span class="eyebrow">More than just a timetable</span>
                <h1>
                    Find your next
                    <br />
                    <strong>campus moment.</strong>
                </h1>
                <p>
                    From inspiring workshops to unforgettable cultural nights. Explore what’s happening, save your seat,
                    and be part of it.
                </p>
                <button onclick="document.getElementById('search').focus()">Explore events</button>
            </div>
            <div class="hero-art" aria-hidden="true">
                <div class="calendar-art">
                    <div class="month">${today.toLocaleString('en', { month: 'short' }).toUpperCase()}</div>
                    <div class="day">${today.getDate()}</div>
                    <div class="caption">MAKE ROOM FOR SOMETHING NEW</div>
                </div>
            </div>
        </section>
        <form class="filters" onsubmit="filterEvents(event)">
            ${field('search', 'Search events', 'search', '', 'placeholder="What are you interested in?"')}${select(
                'category',
                'Category',
                ['All categories', ...config.categories],
                'All categories',
            )}${field('from', 'Starting from', 'date')}${field(
                'location',
                'Location',
                'search',
                '',
                'placeholder="Campus or venue"',
            )}
            <button type="submit">Find events</button>
        </form>
        <div class="section-head">
            <h2>Discover what’s happening</h2>
            <span id="event-count" class="muted"></span>
        </div>
        <div class="grid" id="event-list"></div>
    `;
    await loadEvents();
}
function filterEvents(event) {
    return submit(event, loadEvents);
}
async function loadEvents(data = {}) {
    const query = new URLSearchParams();
    if (data.search) query.set('q', data.search);
    if (data.category && data.category !== 'All categories') query.set('category', data.category);
    if (data.from) query.set('from', data.from);
    if (data.location) query.set('location', data.location);
    currentEvents = await api('/events?' + query);
    $('#event-count').textContent = `${currentEvents.length} events to explore`;
    $('#event-list').innerHTML =
        currentEvents.map(eventCard).join('') ||
        empty('Your next moment is on its way', 'No events match yet. Try another filter or check back soon.');
}
function eventCard(event) {
    const start = new Date(event.start);
    return /* HTML */ `
        <article class="event-card">
            <div class="event-art" data-category="${esc(event.category)}">
                ${event.poster
                    ? /* HTML */ `
                          <img src="${esc(event.poster)}" alt="${esc(event.title)} poster" loading="lazy" />
                      `
                    : '<span class="art-symbol" aria-hidden="true">◯ +</span>'}
                <div class="date-chip">
                    <b>${start.getDate()}</b>
                    ${start.toLocaleString('en', { month: 'short' }).toUpperCase()}
                </div>
            </div>
            <div class="card-content">
                ${tag(event.category)}
                <h3>${esc(event.title)}</h3>
                <p>${esc(event.description.replace(/[#*_]/g, '').slice(0, 90))}…</p>
                <div class="meta">${esc(date(event.start))}</div>
                <div class="meta">${esc(event.venue?.name)} · ${esc(event.venue?.location)}</div>
                <div class="card-bottom">
                    <span class="muted">${Math.max(0, event.capacity - event.registered)} seats left</span>
                    <button class="small ghost" onclick="location.hash='detail/${event._id}'">View event →</button>
                </div>
            </div>
        </article>
    `;
}

async function detail(id) {
    const event = await api(`/events/${id}?source=${encodeURIComponent(eventSource)}`);
    const registrations = me?.role === 'student' ? await api('/my/registrations') : [];
    const registration = registrations.find((item) => item.event?._id === id);
    const feedback = event.feedback;
    const ownFeedback = feedback.find((item) => item.user?._id === me?.id);
    const canManage = me && (me.role === 'admin' || event.organizer?._id === me.id);
    const canReview = registration?.status === 'checked-in' && new Date(event.end) <= new Date();
    $('#app').innerHTML = /* HTML */ `
        ${heading(
            event.title,
            `Hosted by ${event.organizer?.name || 'Organizer'}`,
            '<a href="#events">← All events</a>',
        )}
        <div class="detail-grid">
            <div>
                <section class="panel">
                    ${tag(event.category)}
                    ${tag(event.status)}${event.poster
                        ? /* HTML */ `
                              <img class="detail-poster" src="${esc(event.poster)}" alt="Event poster" />
                          `
                        : ''}
                    <h2>About this event</h2>
                    <div class="prose">${event.descriptionHtml}</div>
                    ${event.reviewReason
                        ? /* HTML */ `
                              <div class="notice">Admin review: ${esc(event.reviewReason)}</div>
                          `
                        : ''}${event.review?.rating
                        ? /* HTML */ `
                              <div class="notice">
                                  Execution rating: ${event.review.rating}/5
                                  <br />
                                  Compliance: ${esc(event.review.compliance)}
                                  <br />
                                  Strengths: ${esc(event.review.strengths)}
                                  <br />
                                  Improvements: ${esc(event.review.improvements)}
                              </div>
                          `
                        : ''}
                </section>
                <section class="panel">
                    <h2>From the attendees</h2>
                    ${feedback
                        .map(
                            (item) => /* HTML */ `
                                <div class="list-item">
                                    <div>
                                        <b>${esc(item.user?.name || 'Student')}</b>
                                        ${tag(item.sentiment)}
                                        <p>${item.rating}/5 · ${esc(item.comment)}</p>
                                        ${item.response
                                            ? /* HTML */ `
                                                  <div class="notice">Organizer: ${esc(item.response)}</div>
                                              `
                                            : ''}
                                    </div>
                                    <div class="actions">
                                        ${canManage
                                            ? /* HTML */ `
                                                  <button
                                                      class="ghost small"
                                                      onclick="respondFeedback('${item._id}','${id}')"
                                                  >
                                                      Respond
                                                  </button>
                                              `
                                            : ''}${me && (me.id === item.user?._id || me.role === 'admin')
                                            ? /* HTML */ `
                                                  <button
                                                      class="danger small"
                                                      onclick="deleteFeedback('${item._id}','${id}')"
                                                  >
                                                      Delete
                                                  </button>
                                              `
                                            : ''}
                                    </div>
                                </div>
                            `,
                        )
                        .join('') || '<p>No reviews yet. Be the first to share your experience.</p>'}${canReview
                        ? /* HTML */ `
                              <h3>${ownFeedback ? 'Edit your feedback' : 'Share your experience'}</h3>
                              <form onsubmit="saveFeedback(event,'${id}')">
                                  <div class="form-grid">
                                      ${['rating', 'quality', 'organization', 'venueSuitability', 'relevance', 'value']
                                          .map((key) =>
                                              select(
                                                  key,
                                                  {
                                                      rating: 'Overall rating',
                                                      quality: 'Event quality',
                                                      organization: 'Organization',
                                                      venueSuitability: 'Venue suitability',
                                                      relevance: 'Content relevance',
                                                      value: 'Overall value',
                                                  }[key],
                                                  ['1', '2', '3', '4', '5'],
                                                  String(ownFeedback?.[key] || 5),
                                              ),
                                          )
                                          .join('')}
                                  </div>
                                  ${field(
                                      'comment',
                                      'Comments & improvement suggestions',
                                      'textarea',
                                      ownFeedback?.comment || '',
                                      'maxlength="1000"',
                                  )}
                                  <button type="submit">Save feedback</button>
                              </form>
                          `
                        : '<p class="muted">Feedback opens after the event ends, for checked-in attendees.</p>'}
                </section>
            </div>
            <aside>
                <section class="panel">
                    <h2>The essentials</h2>
                    <label>When</label>
                    <p>
                        ${esc(date(event.start))}
                        <br />
                        to ${esc(date(event.end))}
                    </p>
                    <label>Where</label>
                    <p>
                        ${esc(event.venue?.name)}
                        <br />
                        ${esc(event.venue?.location)}
                        <br />
                        ${esc(event.venue?.amenities?.join(', '))}
                    </p>
                    <label>Capacity</label>
                    <p>${event.registered} / ${event.capacity} allocated seats</p>
                    ${event.status === 'approved' && new Date(event.start) > new Date()
                        ? me?.role === 'student'
                            ? registration && registration.status !== 'cancelled'
                                ? /* HTML */ `
                                      ${tag(registration.status)}
                                      <button class="danger" onclick="cancelRegistration('${id}')">
                                          Cancel registration
                                      </button>
                                  `
                                : /* HTML */ `
                                      <button onclick="registerEvent('${id}')">
                                          ${event.registered < event.capacity ? 'Reserve my seat' : 'Join waitlist'}
                                      </button>
                                  `
                            : !me
                              ? '<a href="#login">Log in to register →</a>'
                              : '<p class="muted">Student accounts can register.</p>'
                        : '<p class="muted">Registration is closed.</p>'}
                </section>
                ${me?.role === 'student' && ['registered', 'checked-in'].includes(registration?.status)
                    ? /* HTML */ `
                          <section class="panel">
                              <h3>Meet your people</h3>
                              <p>Connect with attendees who have opted in to sharing their email.</p>
                              <button class="ghost" onclick="connections('${id}')">Find attendees</button>
                              <div id="connections"></div>
                          </section>
                      `
                    : ''}${canManage
                    ? /* HTML */ `
                          <section class="panel">
                              <h3>Organizer tools</h3>
                              <div class="actions">
                                  <button class="ghost" onclick="attendees('${id}')">Attendees & check-in</button>
                                  <button class="ghost" onclick="shareEvent('${id}')">Promotion link</button>
                                  <button class="ghost" onclick="messageAttendees('${id}')">Notify attendees</button>
                              </div>
                          </section>
                      `
                    : ''}
            </aside>
        </div>
    `;
}
function registerEvent(id) {
    return run(async () => {
        const result = await api(`/events/${id}/register`, 'POST', { source: eventSource });
        toast(result.status === 'waitlisted' ? 'Added to the waitlist.' : 'Your seat is reserved.');
        await detail(id);
    });
}
function cancelRegistration(id) {
    return run(async () => {
        if (!confirm('Cancel this registration?')) return;
        await api(`/events/${id}/register`, 'DELETE');
        toast('Registration cancelled.');
        await route();
    });
}
function saveFeedback(event, id) {
    return submit(event, async (data) => {
        await api(`/events/${id}/feedback`, 'POST', data);
        toast('Feedback saved.');
        await detail(id);
    });
}
function deleteFeedback(feedbackId, eventId) {
    return run(async () => {
        if (!confirm('Delete this feedback?')) return;
        await api(`/feedback/${feedbackId}`, 'DELETE');
        await detail(eventId);
    });
}
function respondFeedback(feedbackId, eventId) {
    return run(async () => {
        const response = prompt('Your response (up to 1000 characters):');
        if (response === null) return;
        await api(`/feedback/${feedbackId}/response`, 'PUT', { response });
        await detail(eventId);
    });
}
function connections(id) {
    return run(async () => {
        const users = await api(`/events/${id}/connect`);
        $('#connections').innerHTML =
            users
                .map(
                    (user) => /* HTML */ `
                        <div class="list-item">
                            <div>
                                <b>${esc(user.name)}</b>
                                <p>
                                    ${esc(user.email)}
                                    <br />
                                    ${esc(user.interests.join(', '))}
                                </p>
                            </div>
                        </div>
                    `,
                )
                .join('') || '<p>No opted-in attendees yet.</p>';
    });
}
function shareEvent(id) {
    return run(async () => {
        const label = prompt('Traffic source label (e.g. department-newsletter):', 'campus-share');
        if (label === null) return;
        const url = location.origin + '/#detail/' + id + '?source=' + encodeURIComponent(label);
        try {
            await navigator.clipboard.writeText(url);
            toast('Promotion link copied.');
        } catch {
            openModal(
                'Promotion link',
                /* HTML */ `
                    <p>Share this link to track views and registrations.</p>
                    <input aria-label="Promotion link" readonly value="${esc(url)}" />
                `,
            );
        }
    });
}
function messageAttendees(id) {
    return run(async () => {
        const message = prompt('Message for registered/waitlisted attendees:');
        if (!message) return;
        await api(`/events/${id}/notify`, 'POST', { message });
        toast('Notification sent.');
    });
}

async function dashboard() {
    const user = await api('/profile');
    if (me.role === 'student') {
        const registrations = await api('/my/registrations');
        $('#app').innerHTML = /* HTML */ `
            ${heading(
                `Hello, ${me.name.split(' ')[0]}.`,
                'Your plans, your people, your campus.',
                '<a href="#events">Discover more events →</a>',
            )}
            <div class="tiles">
                <div class="tile">
                    <strong>${registrations.filter((item) => item.status === 'registered').length}</strong>
                    <span>Reserved seats</span>
                </div>
                <div class="tile">
                    <strong>${registrations.filter((item) => item.status === 'checked-in').length}</strong>
                    <span>Events attended</span>
                </div>
                <div class="tile">
                    <strong>${registrations.filter((item) => item.status === 'waitlisted').length}</strong>
                    <span>On the waitlist</span>
                </div>
            </div>
            <h2>My events & tickets</h2>
            ${registrations
                .map(
                    (item) => /* HTML */ `
                        <section class="panel ticket">
                            <div>
                                ${tag(item.status)} ${tag(item.event?.status)}
                                <h3>${esc(item.event?.title || 'Removed event')}</h3>
                                <p>${esc(date(item.event?.start))} · ${esc(item.event?.venue?.name)}</p>
                                <div class="actions">
                                    <button class="ghost small" onclick="location.hash='detail/${item.event?._id}'">
                                        Event details
                                    </button>
                                    ${['registered', 'waitlisted'].includes(item.status)
                                        ? /* HTML */ `
                                              <button
                                                  class="danger small"
                                                  onclick="cancelRegistration('${item.event?._id}')"
                                              >
                                                  Cancel RSVP
                                              </button>
                                          `
                                        : ''}
                                </div>
                                ${['registered', 'checked-in'].includes(item.status)
                                    ? /* HTML */ `
                                          <p class="code">${esc(item.qrCode)}</p>
                                      `
                                    : ''}
                            </div>
                            ${['registered', 'checked-in'].includes(item.status)
                                ? /* HTML */ `
                                      <img
                                          class="qr"
                                          src="/api/registrations/${item._id}/qr"
                                          alt="QR check-in ticket"
                                      />
                                  `
                                : ''}
                        </section>
                    `,
                )
                .join('') || empty('Your schedule is a blank canvas', 'Discover an event and reserve your first seat.')}
        `;
        return;
    }
    currentEvents = await api('/events' + (me.role === 'organizer' ? '?mine=1' : ''));
    const admin = me.role === 'admin';
    $('#app').innerHTML = /* HTML */ `
        ${heading(
            admin ? 'Campus overview' : 'Bring your ideas to life.',
            admin
                ? 'A clear view of everything happening across campus.'
                : 'Create experiences. Manage attendees. Make an impact.',
            '<button onclick="eventForm()">+ Create an event</button>',
        )}${!admin && !user.verified
            ? '<div class="notice warning">Your organization is awaiting admin verification. Event creation becomes available once approved.</div>'
            : ''}
        <div class="tiles">
            <div class="tile">
                <strong>${currentEvents.length}</strong>
                <span>Total events</span>
            </div>
            <div class="tile">
                <strong>${currentEvents.filter((item) => item.status === 'pending').length}</strong>
                <span>Awaiting approval</span>
            </div>
            <div class="tile">
                <strong>${currentEvents.filter((item) => item.status === 'approved').length}</strong>
                <span>Approved</span>
            </div>
        </div>
        <section class="panel">
            <h2>${admin ? 'Event moderation' : 'My events'}</h2>
            ${currentEvents.length
                ? /* HTML */ `
                      <div class="table-wrap">
                          <table>
                              <thead>
                                  <tr>
                                      <th>Event</th>
                                      <th>Date</th>
                                      <th>Status</th>
                                      <th>Seats</th>
                                      <th>Manage</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${currentEvents
                                      .map(
                                          (item) => /* HTML */ `
                                              <tr>
                                                  <td>
                                                      <a href="#detail/${item._id}">${esc(item.title)}</a>
                                                      <div class="muted">${esc(item.organizer?.name)}</div>
                                                  </td>
                                                  <td>${esc(date(item.start))}</td>
                                                  <td>${tag(item.status)}</td>
                                                  <td>${item.registered}/${item.capacity}</td>
                                                  <td>
                                                      <div class="actions">
                                                          ${!['cancelled', 'archived'].includes(item.status) &&
                                                          new Date(item.start) > new Date()
                                                              ? /* HTML */ `
                                                                    <button
                                                                        class="ghost small"
                                                                        onclick="eventForm('${item._id}')"
                                                                    >
                                                                        Edit
                                                                    </button>
                                                                `
                                                              : ''}
                                                          <button
                                                              class="ghost small"
                                                              onclick="attendees('${item._id}')"
                                                          >
                                                              Attendees
                                                          </button>
                                                          ${admin && ['pending', 'rejected'].includes(item.status)
                                                              ? /* HTML */ `
                                                                    <button
                                                                        class="small"
                                                                        onclick="reviewEvent('${item._id}','approved')"
                                                                    >
                                                                        Approve
                                                                    </button>
                                                                    <button
                                                                        class="danger small"
                                                                        onclick="reviewEvent('${item._id}','rejected')"
                                                                    >
                                                                        Reject
                                                                    </button>
                                                                `
                                                              : ''}${admin && new Date(item.end) < new Date()
                                                              ? /* HTML */ `
                                                                    <button
                                                                        class="ghost small"
                                                                        onclick="evaluationForm('${item._id}')"
                                                                    >
                                                                        Evaluate
                                                                    </button>
                                                                `
                                                              : ''}${item.status !== 'archived'
                                                              ? /* HTML */ `
                                                                    <button
                                                                        class="danger small"
                                                                        onclick="removeEvent('${item._id}',${new Date(
                                                                            item.end,
                                                                        ) < new Date()})"
                                                                    >
                                                                        ${new Date(item.end) < new Date()
                                                                            ? 'Archive'
                                                                            : 'Cancel'}
                                                                    </button>
                                                                `
                                                              : ''}
                                                      </div>
                                                  </td>
                                              </tr>
                                          `,
                                      )
                                      .join('')}
                              </tbody>
                          </table>
                      </div>
                  `
                : empty('Start with an idea', 'Create your first event to bring campus together.')}
        </section>
        <div id="admin-users"></div>
    `;
    if (admin) {
        const users = await api('/admin/users');
        currentUsers = users;
        const health = await api('/health');
        $('#admin-users').innerHTML = /* HTML */ `
            <section class="panel">
                <div class="page-heading">
                    <h2>Users & organizer verification</h2>
                    <button onclick="userForm()">+ Create user</button>
                </div>
                <p class="muted">
                    Verify registration numbers against college records before approving an organization.
                </p>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Role</th>
                                <th>Registration number</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users
                                .map(
                                    (item) => /* HTML */ `
                                        <tr>
                                            <td>
                                                ${esc(item.name)}
                                                <div class="muted">${esc(item.email)}</div>
                                            </td>
                                            <td>${esc(item.role)}</td>
                                            <td>${esc(item.organizationRegistrationNumber || '—')}</td>
                                            <td>
                                                ${item.active ? 'Active' : 'Inactive'}
                                                <br />
                                                ${item.emailVerified ? 'Email confirmed' : 'Email unconfirmed'}
                                            </td>
                                            <td>
                                                <div class="actions">
                                                    ${item._id !== me.id
                                                        ? /* HTML */ `
                                                              <button
                                                                  class="ghost small"
                                                                  onclick="userForm('${item._id}')"
                                                              >
                                                                  Edit / reset password
                                                              </button>
                                                          `
                                                        : ''}
                                                    ${item.role === 'organizer'
                                                        ? /* HTML */ `
                                                              <button
                                                                  class="ghost small"
                                                                  onclick="updateUser('${item._id}','verified',${!item.verified})"
                                                              >
                                                                  ${item.verified
                                                                      ? 'Revoke verification'
                                                                      : 'Verify organization'}
                                                              </button>
                                                          `
                                                        : ''}${item._id !== me.id
                                                        ? /* HTML */ `
                                                              <button
                                                                  class="ghost small"
                                                                  onclick="updateUser('${item._id}','active',${!item.active})"
                                                              >
                                                                  ${item.active ? 'Deactivate' : 'Activate'}
                                                              </button>
                                                          `
                                                        : ''}
                                                </div>
                                            </td>
                                        </tr>
                                    `,
                                )
                                .join('')}
                        </tbody>
                    </table>
                </div>
            </section>
            <div class="notice">
                System status: database ${esc(health.database)} · Uptime ${health.uptime}s. Policies: verified
                organizers, approved events, capacity enforcement.
            </div>
        `;
    }
}

function localDate(value) {
    const time = value ? new Date(value) : new Date(Date.now() + 86400000);
    return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function eventForm(id) {
    return run(async () => {
        currentVenues = await api('/venues');
        const item = currentEvents.find((event) => event._id === id) || {};
        const organizers =
            me.role === 'admin' && !id
                ? (await api('/admin/users')).filter(
                      (user) => user.role === 'organizer' && user.active && user.emailVerified && user.verified,
                  )
                : [];
        if (me.role === 'admin' && !id && !organizers.length)
            throw new Error('Create and verify an organizer before creating an event.');
        openModal(
            id ? 'Edit & resubmit event' : 'Create a campus moment',
            /* HTML */ `
                <form onsubmit="saveEvent(event,'${id || ''}')">
                    <div class="form-grid">
                        ${me.role === 'admin' && !id
                            ? /* HTML */ `
                                  <div class="full">
                                      <label for="organizer">Responsible organizer</label>
                                      <select name="organizer" id="organizer" required>
                                          ${organizers
                                              .map(
                                                  (user) => /* HTML */ `
                                                      <option value="${esc(user._id)}">
                                                          ${esc(user.name)} · ${esc(user.email)}
                                                      </option>
                                                  `,
                                              )
                                              .join('')}
                                      </select>
                                  </div>
                              `
                            : ''}
                        ${field(
                            'title',
                            'Event title',
                            'text',
                            item.title || '',
                            'required minlength="2" maxlength="200"',
                        )}${select('category', 'Category', config.categories, item.category)}
                        <div class="full">
                            ${field(
                                'description',
                                'Description (Markdown, minimum 50 characters)',
                                'textarea',
                                item.description || '',
                                'required minlength="50"',
                            )}
                        </div>
                        ${field('start', 'Starts at', 'datetime-local', localDate(item.start), 'required')}${field(
                            'end',
                            'Ends at (minimum 1 hour)',
                            'datetime-local',
                            localDate(item.end || Date.now() + 90000000),
                            'required',
                        )}
                        <div>
                            <label for="venue">Venue</label>
                            <select name="venue" id="venue" required>
                                ${currentVenues
                                    .map(
                                        (venue) => /* HTML */ `
                                            <option
                                                value="${venue._id}"
                                                ${venue._id === item.venue?._id ? 'selected' : ''}
                                            >
                                                ${esc(venue.name)} · ${venue.capacity} seats
                                            </option>
                                        `,
                                    )
                                    .join('')}
                            </select>
                        </div>
                        ${field(
                            'capacity',
                            'Event capacity',
                            'number',
                            item.capacity || 50,
                            'required min="1" step="1"',
                        )}${field('budget', 'Budget', 'number', item.budget || 0, 'min="0" step="0.01"')}${field(
                            'poster',
                            'Poster image (JPG/PNG, max 5 MB)',
                            'file',
                            '',
                            'accept="image/jpeg,image/png"',
                        )}
                        <div class="full">
                            ${field(
                                'breakdown',
                                `Budget breakdown (required above ${config.budgetThreshold})`,
                                'textarea',
                                (item.breakdown || []).map((part) => `${part.label}: ${part.amount}`).join('\n'),
                                'placeholder="Equipment: 6000&#10;Catering: 5000"',
                            )}
                        </div>
                    </div>
                    <p class="muted">
                        One item per line: label: amount. Dates are entered in your local timezone; title uniqueness is
                        checked per UTC day. All edits return to admin approval.
                    </p>
                    <div class="actions end"><button type="submit">Submit for approval</button></div>
                </form>
            `,
        );
    });
}
async function uploadImage(form, key, kind = 'image') {
    const file = form.elements[key]?.files[0];
    if (!file) return '';
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be at most 5 MB.');
    const body = new FormData();
    body.set('image', file);
    body.set('kind', kind);
    return (await api('/uploads', 'POST', body)).url;
}
function saveEvent(event, id) {
    return submit(event, async (data, form) => {
        const old = currentEvents.find((item) => item._id === id);
        const poster = (await uploadImage(form, 'poster')) || old?.poster || '';
        const breakdown = data.breakdown
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
                const split = line.lastIndexOf(':');
                if (split < 1) throw new Error('Use label: amount for each budget item.');
                return { label: line.slice(0, split).trim(), amount: Number(line.slice(split + 1).trim()) };
            });
        await api('/events' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
            ...data,
            poster,
            breakdown,
            start: new Date(data.start).toISOString(),
            end: new Date(data.end).toISOString(),
        });
        closeModal();
        toast('Event submitted for approval.');
        await dashboard();
    });
}
function reviewEvent(id, status) {
    return run(async () => {
        const reason = prompt('Review note / reason:', '');
        if (reason === null) return;
        await api(`/events/${id}/review`, 'PUT', { status, reason });
        toast('Review saved.');
        await dashboard();
    });
}
function removeEvent(id, archive) {
    return run(async () => {
        if (!confirm(archive ? 'Archive this event?' : 'Cancel this event and notify attendees?')) return;
        await api(`/events/${id}?archive=${archive}`, 'DELETE');
        await dashboard();
    });
}
function userForm(id) {
    const item = currentUsers.find((user) => user._id === id) || {};
    openModal(
        id ? 'Edit user / reset password' : 'Create user',
        /* HTML */ `
            <form onsubmit="saveUser(event,'${id || ''}')">
                ${field('name', 'Full name', 'text', item.name || '', 'required minlength="2" maxlength="100"')}
                ${field(
                    'email',
                    'Email',
                    'email',
                    item.email || '',
                    config.demoUsers?.some((user) => user.email === item.email) ? 'required readonly' : 'required',
                )}
                ${field('phone', 'Phone', 'tel', item.phone || '', 'required pattern="[+]?[0-9]{10,15}"')}
                ${field(
                    'password',
                    id ? 'New password (leave blank to keep current)' : 'Password',
                    'password',
                    '',
                    (id ? '' : 'required ') + 'minlength="8" maxlength="128" autocomplete="new-password"',
                )}
                ${id
                    ? `<p>Role: ${esc(item.role)}. Roles are fixed once an account is created.</p>`
                    : select('role', 'Role', ['student', 'organizer', 'admin'], 'student') +
                      field(
                          'organizationRegistrationNumber',
                          'Organization registration number (organizers only)',
                          'text',
                          '',
                          'maxlength="50"',
                      ) +
                      '<label class="check"><input type="checkbox" name="verified" /> I have verified the organizer against college records</label>'}
                <p class="muted">
                    Admin-created accounts are email-confirmed and can log in immediately. Organizers also need
                    organization verification before creating events.
                </p>
                <div class="actions end"><button type="submit">Save user</button></div>
            </form>
        `,
    );
}
function saveUser(event, id) {
    return submit(event, async (data) => {
        if (!id) data.verified = data.verified === 'on';
        await api('/admin/users' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', data);
        closeModal();
        toast('User saved in MongoDB.');
        await dashboard();
    });
}
function updateUser(id, key, value) {
    return run(async () => {
        await api(`/admin/users/${id}`, 'PUT', { [key]: value });
        toast('User updated.');
        await dashboard();
    });
}
function evaluationForm(id) {
    openModal(
        'Event execution evaluation',
        /* HTML */ `
            <form onsubmit="saveEvaluation(event,'${id}')">
                ${select('rating', 'Admin rating', ['1', '2', '3', '4', '5'], '5')}${field(
                    'compliance',
                    'Compliance & adherence to college guidelines',
                    'textarea',
                    '',
                    'required maxlength="1000"',
                )}${field('strengths', 'Strengths & attendee satisfaction', 'textarea', '', 'maxlength="1000"')}${field(
                    'improvements',
                    'Areas for improvement & recommendations',
                    'textarea',
                    '',
                    'maxlength="1000"',
                )}
                <button type="submit">Save evaluation</button>
            </form>
        `,
    );
}
function saveEvaluation(event, id) {
    return submit(event, async (data) => {
        await api(`/events/${id}/evaluation`, 'PUT', data);
        closeModal();
        toast('Evaluation saved.');
        await dashboard();
    });
}

function removeAttendee(registrationId, eventId) {
    return run(async () => {
        if (!confirm('Cancel this student registration?')) return;
        await api(`/registrations/${registrationId}`, 'DELETE');
        await attendees(eventId);
    });
}

function attendees(id) {
    return run(async () => {
        const rows = await api(`/events/${id}/attendees`);
        openModal(
            'Attendees & check-in',
            /* HTML */ `
                <form onsubmit="checkInCode(event,'${id}')">
                    <label for="qrCode">Scan with an external QR reader or paste the ticket code</label>
                    <div class="actions">
                        ${field('qrCode', 'Ticket code', 'text', '', 'required')}
                        <button type="submit">Check in</button>
                    </div>
                </form>
                <p class="muted">Check-in opens at the event start. No-shows are marked after it ends.</p>
                ${rows.length
                    ? /* HTML */ `
                          <div class="table-wrap">
                              <table>
                                  <thead>
                                      <tr>
                                          <th>Student</th>
                                          <th>Status</th>
                                          <th>Attendance</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${rows
                                          .map(
                                              (item) => /* HTML */ `
                                                  <tr>
                                                      <td>
                                                          ${esc(item.user?.name)}
                                                          <div class="muted">${esc(item.user?.email)}</div>
                                                      </td>
                                                      <td>${tag(item.status)}</td>
                                                      <td>
                                                          ${item.status === 'registered'
                                                              ? /* HTML */ `
                                                                    <div class="actions">
                                                                        <button
                                                                            class="small"
                                                                            onclick="changeAttendance('${item._id}','checked-in','${id}')"
                                                                        >
                                                                            Check in
                                                                        </button>
                                                                        <button
                                                                            class="ghost small"
                                                                            onclick="changeAttendance('${item._id}','no-show','${id}')"
                                                                        >
                                                                            No-show
                                                                        </button>
                                                                    </div>
                                                                `
                                                              : '—'}
                                                          ${['registered', 'waitlisted'].includes(item.status)
                                                              ? /* HTML */ `
                                                                    <button
                                                                        class="danger small"
                                                                        onclick="removeAttendee('${item._id}','${id}')"
                                                                    >
                                                                        Cancel RSVP
                                                                    </button>
                                                                `
                                                              : ''}
                                                      </td>
                                                  </tr>
                                              `,
                                          )
                                          .join('')}
                                  </tbody>
                              </table>
                          </div>
                      `
                    : empty('No attendees yet')}
            `,
        );
    });
}
function checkInCode(event, id) {
    return submit(event, async (data) => {
        await api(`/events/${id}/check-in`, 'POST', data);
        toast('Attendee checked in.');
        await attendees(id);
    });
}
function changeAttendance(registrationId, status, eventId) {
    return run(async () => {
        await api(`/registrations/${registrationId}/status`, 'PUT', { status });
        toast('Attendance updated.');
        await attendees(eventId);
    });
}

async function venues() {
    if (me.role !== 'admin') return dashboard();
    currentVenues = await api('/venues');
    $('#app').innerHTML = /* HTML */ `
        ${heading(
            'Spaces for every idea.',
            'Manage venues, capacities, amenities, and upcoming bookings.',
            '<button onclick="venueForm()">+ Add venue</button>',
        )}
        <div class="grid">
            ${currentVenues
                .map(
                    (item) => /* HTML */ `
                        <section class="panel">
                            ${item.images?.[0]
                                ? /* HTML */ `
                                      <img class="detail-poster" src="${esc(item.images[0])}" alt="${esc(item.name)}" />
                                  `
                                : ''}${tag(`${item.capacity} seats`)}
                            <h3>${esc(item.name)}</h3>
                            <p>
                                ${esc(item.location)}
                                <br />
                                ${esc(item.amenities.join(', '))}
                            </p>
                            <div class="actions">
                                <button class="ghost small" onclick="venueForm('${item._id}')">Edit</button>
                                <button class="danger small" onclick="archiveVenue('${item._id}')">Archive</button>
                            </div>
                            <h3 style="margin-top:22px">Upcoming bookings</h3>
                            ${item.bookings
                                .map(
                                    (booking) => /* HTML */ `
                                        <div class="muted">
                                            ${esc(booking.title)}
                                            <br />
                                            ${esc(date(booking.start))} – ${esc(date(booking.end))}
                                        </div>
                                    `,
                                )
                                .join('<hr>') || '<p class="muted">Available — no upcoming bookings.</p>'}
                        </section>
                    `,
                )
                .join('') || empty('A space for something new', 'Add your first campus venue.')}
        </div>
    `;
}
function venueForm(id) {
    const item = currentVenues.find((venue) => venue._id === id) || {};
    openModal(
        id ? 'Edit venue' : 'Add campus venue',
        /* HTML */ `
            <form onsubmit="saveVenue(event,'${id || ''}')">
                <div class="form-grid">
                    ${field('name', 'Venue name', 'text', item.name || '', 'required')}${field(
                        'location',
                        'Location',
                        'text',
                        item.location || '',
                        'required',
                    )}${field(
                        'capacity',
                        'Capacity',
                        'number',
                        item.capacity || 100,
                        'required min="1" step="1"',
                    )}${field('amenities', 'Amenities (comma separated)', 'text', (item.amenities || []).join(', '))}
                    <div class="full">
                        ${field(
                            'image',
                            'Venue image (JPG/PNG, max 5 MB)',
                            'file',
                            '',
                            'accept="image/jpeg,image/png"',
                        )}
                    </div>
                </div>
                <div class="actions end"><button type="submit">Save venue</button></div>
            </form>
        `,
    );
}
function saveVenue(event, id) {
    return submit(event, async (data, form) => {
        const image = await uploadImage(form, 'image');
        const old = currentVenues.find((item) => item._id === id);
        await api('/venues' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
            ...data,
            images: image ? [image] : old?.images || [],
        });
        closeModal();
        toast('Venue saved.');
        await venues();
    });
}
function archiveVenue(id) {
    return run(async () => {
        if (!confirm('Archive this venue? Existing upcoming bookings must be moved first.')) return;
        await api(`/venues/${id}`, 'DELETE');
        await venues();
    });
}

async function profile() {
    const user = await api('/profile');
    $('#app').innerHTML = /* HTML */ `
        ${heading('Make it yours.', 'Keep your details and preferences up to date.')}
        <section class="panel" style="max-width:720px">
            <h2>${esc(user.name)}</h2>
            <p>${esc(user.email)} · ${esc(user.role)}</p>
            <form onsubmit="saveProfile(event)">
                <div class="form-grid">
                    ${field('name', 'Full name', 'text', user.name, 'required minlength="2" maxlength="100"')}${field(
                        'phone',
                        'Phone',
                        'tel',
                        user.phone,
                        'required pattern="[+]?[0-9]{10,15}"',
                    )}
                    <div class="full">
                        ${field('interests', 'Interests (comma separated)', 'text', user.interests.join(', '))}
                    </div>
                </div>
                <label class="check">
                    <input name="reminders" type="checkbox" ${user.preferences.reminders ? 'checked' : ''} />
                    Receive event reminders
                </label>
                <label class="check">
                    <input name="connect" type="checkbox" ${user.preferences.connect ? 'checked' : ''} />
                    Share my name, email, and interests with opted-in attendees of my events
                </label>
                <button type="submit">Save profile</button>
            </form>
            ${me.role !== 'admin'
                ? '<div class="section-head"><span class="muted">Leaving campus? Cancel upcoming registrations first.</span><button class="danger small" onclick="deactivate()">Deactivate account</button></div>'
                : ''}
        </section>
    `;
}
function saveProfile(event) {
    return submit(event, async (data, form) => {
        me = await api('/profile', 'PUT', {
            ...data,
            reminders: form.elements.reminders.checked,
            connect: form.elements.connect.checked,
        });
        renderNavigation();
        toast('Profile saved.');
    });
}
function deactivate() {
    return run(async () => {
        if (!confirm('Deactivate your account?')) return;
        await api('/profile', 'DELETE');
        me = null;
        location.hash = 'events';
        await route();
    });
}

async function notifications() {
    const items = await api('/notifications');
    $('#app').innerHTML = /* HTML */ `
        ${heading(
            'Stay in the loop.',
            'RSVP confirmations, reminders, and updates — all in one place.',
            '<div class="actions"><button class="ghost" onclick="markRead()">Mark all read</button><button class="ghost" onclick="clearNotifications()">Clear read / archived</button></div>',
        )}
        <section class="panel">
            ${items
                .filter((item) => !item.archived)
                .map(
                    (item) => /* HTML */ `
                        <div class="list-item ${item.read ? '' : 'unread'}">
                            <div>
                                <b>${esc(item.message)}</b>
                                <p>${esc(date(item.createdAt))}</p>
                            </div>
                            <button class="ghost small" onclick="archiveNotification('${item._id}')">Archive</button>
                        </div>
                    `,
                )
                .join('') || empty('All caught up', 'Your next update will appear here.')}
        </section>
    `;
}
function markRead() {
    return run(async () => {
        await api('/notifications/read', 'PUT');
        await notifications();
    });
}
function clearNotifications() {
    return run(async () => {
        await api('/notifications', 'DELETE');
        await notifications();
    });
}
function archiveNotification(id) {
    return run(async () => {
        await api(`/notifications/${id}/archive`, 'PUT');
        await notifications();
    });
}

async function reports() {
    currentReport = await api('/reports');
    $('#app').innerHTML = /* HTML */ `
        ${heading(
            me.role === 'student' ? 'Your campus story.' : 'Good events. Better insights.',
            'Real activity, clear reports. Export any table as CSV.',
            '<button class="ghost" onclick="downloadReport()">Export full report (JSON)</button>',
        )}
        <div class="tiles">
            ${Object.entries(currentReport.metrics)
                .map(
                    ([label, count]) => /* HTML */ `
                        <div class="tile">
                            <strong>${esc(count)}</strong>
                            <span>${esc(label)}</span>
                        </div>
                    `,
                )
                .join('')}
        </div>
        ${Object.entries(currentReport.tables)
            .map(
                ([name, rows], index) => /* HTML */ `
                    <details class="panel report-section" ${index === 0 ? 'open' : ''}>
                        <summary>
                            ${esc(name)}
                            <span class="muted">(${rows.length})</span>
                        </summary>
                        <div class="actions end">
                            <button class="ghost small" onclick="downloadCSV(${esc(JSON.stringify(name))})">
                                Export CSV
                            </button>
                        </div>
                        ${table(rows)}
                    </details>
                `,
            )
            .join('')}${currentReport.recommendations
            ? /* HTML */ `
                  <div class="section-head">
                      <h2>Picked for your interests</h2>
                      <span class="muted">Based on interests & attendance history</span>
                  </div>
                  <div class="grid">
                      ${currentReport.recommendations.map(eventCard).join('') ||
                      empty(
                          'More recommendations soon',
                          'Update your interests and check back as new events are published.',
                      )}
                  </div>
              `
            : ''}
        <p class="muted">
            Sentiment and common themes use simple keyword/word-count rules, not AI. Attendance percentages exclude
            waitlists and cancellations. Peak hours use UTC.
        </p>
    `;
}
function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadReport() {
    download('campus-report.json', JSON.stringify(currentReport, null, 2), 'application/json');
}
function downloadCSV(name) {
    const rows = currentReport.tables[name];
    if (!rows.length) return toast('No rows to export.');
    const keys = Object.keys(rows[0]);
    const cell = (value) => {
        const text = String(value ?? '');
        return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
    };
    download(
        name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv',
        [keys.map(cell).join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\r\n'),
        'text/csv;charset=utf-8',
    );
}

async function help() {
    const items = await api('/suggestions');
    $('#app').innerHTML = /* HTML */ `
        ${heading('Better campus, together.', 'Share a suggestion, report a bug, or tell us what could be better.')}
        <section class="panel">
            <h2>Your voice matters</h2>
            <form onsubmit="saveSuggestion(event)">
                <div class="form-grid">
                    ${select('type', 'Submission type', ['suggestion', 'bug', 'feedback'], 'suggestion')}${field(
                        'title',
                        'Short title',
                        'text',
                        '',
                        'required minlength="2" maxlength="200"',
                    )}
                    <div class="full">
                        ${field(
                            'details',
                            'Details / steps to reproduce / error message',
                            'textarea',
                            '',
                            'required minlength="10" maxlength="3000"',
                        )}
                    </div>
                    ${field(
                        'screenshot',
                        'Screenshot (JPG/PNG, max 5 MB)',
                        'file',
                        '',
                        'accept="image/jpeg,image/png"',
                    )}
                </div>
                <div class="actions end"><button type="submit">Send submission</button></div>
            </form>
        </section>
        <h2>${me.role === 'admin' ? 'Platform feedback dashboard' : 'My submissions & progress'}</h2>
        ${items
            .map(
                (item) => /* HTML */ `
                    <section class="panel">
                        ${tag(item.type)} ${tag(item.status)}
                        <h3>${esc(item.title)}</h3>
                        <p>${esc(item.details)}</p>
                        <span class="muted">${esc(item.user?.name)} · ${esc(date(item.createdAt))}</span>
                        ${item.screenshot
                            ? /* HTML */ `
                                  <p>
                                      <a href="${esc(item.screenshot)}" target="_blank" rel="noopener">
                                          View screenshot
                                      </a>
                                  </p>
                              `
                            : ''}${item.response
                            ? /* HTML */ `
                                  <div class="notice">Admin: ${esc(item.response)}</div>
                              `
                            : ''}${me.role === 'admin'
                            ? /* HTML */ `
                                  <form onsubmit="updateSuggestion(event,'${item._id}')">
                                      <div class="form-grid">
                                          ${select(
                                              'status',
                                              'Implementation status',
                                              ['submitted', 'planned', 'in-progress', 'implemented', 'declined'],
                                              item.status,
                                          )}${field(
                                              'response',
                                              'Admin response',
                                              'text',
                                              item.response,
                                              'maxlength="1000"',
                                          )}
                                      </div>
                                      <div class="actions end"><button type="submit">Update progress</button></div>
                                  </form>
                              `
                            : ''}
                    </section>
                `,
            )
            .join('') || empty('Ideas start here', 'Your submissions and their progress will appear below.')}
    `;
}
function saveSuggestion(event) {
    return submit(event, async (data, form) => {
        const screenshot = await uploadImage(form, 'screenshot', 'screenshot');
        await api('/suggestions', 'POST', { ...data, screenshot });
        toast('Thank you. Submission saved.');
        await help();
    });
}
function updateSuggestion(event, id) {
    return submit(event, async (data) => {
        await api(`/suggestions/${id}`, 'PUT', data);
        toast('Progress updated.');
        await help();
    });
}

window.addEventListener('hashchange', () => route());
run(async () => {
    [config, me] = await Promise.all([api('/config'), api('/auth/me')]);
    await route();
});
