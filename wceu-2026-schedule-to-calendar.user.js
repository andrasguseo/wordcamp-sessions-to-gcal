// ==UserScript==
// @name         WordCamp Europe 2026 Schedule to Calendar
// @namespace    http://tampermonkey.net/
// @version      0.9
// @description  Adds "Add to Google Calendar" and "Download iCal (.ics)" buttons for each session on WordCamp Europe 2026 schedule and individual session pages, and a bulk export for favourited sessions.
// @author       Andras Guseo
// @homepage     https://andrasguseo.com
// @source       https://github.com/andrasguseo/wordcamp-sessions-to-gcal/raw/refs/heads/main/wceu-2026-to-gcal.user.js
// @match        https://europe.wordcamp.org/2026/schedule/
// @match        https://europe.wordcamp.org/2026/session/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration -------------------------------------------------------
    const EVENT_YEAR            = 2026;
    const EVENT_MONTH           = 6;    // June. Month is implicit in the grid-area tokens.
    const EVENT_LOCATION        = 'WordCamp Europe 2026 — ICE Kraków, Poland';
    const DEFAULT_DURATION_MIN  = 30;   // Used only when no end time is available.
    // Timezone offset for Kraków (Europe/Warsaw) during the event. CEST = UTC+2.
    // Used for the schedule page, where times are bare "HH:MM" strings.
    const EVENT_TZ_OFFSET_HOURS = 2;
    const CAL_LINK_CLASS        = 'wc-gcal-link'; // Used to avoid duplicate injection.

    // --- Track helpers -------------------------------------------------------

    /**
     * Produces a short prefix for a track/workshop name.
     *   "Track 1"     -> "T1"
     *   "Workshop 2"  -> "W2"
     *   "Keynote"     -> "K"
     *   Anything else -> first letter of each word, uppercased.
     */
    function shortenTrackName(name) {
        if (!name) return '';
        const trimmed = name.trim();
        // Pattern "<Word> <number>" -> first letter of word + number (Track 1 -> T1).
        const numbered = trimmed.match(/^([A-Za-z])[A-Za-z]*\s+(\d+)$/);
        if (numbered) {
            return numbered[1].toUpperCase() + numbered[2];
        }
        // Otherwise: initials of each word.
        return trimmed
            .split(/\s+/)
            .map(w => w.charAt(0).toUpperCase())
            .join('');
    }

    /**
     * Builds a "[T1]" / "[T1/W2]" style prefix for an event title.
     * Returns an empty string when there are no tracks.
     */
    function buildTitlePrefix(tracks) {
        if (!tracks || tracks.length === 0) return '';
        const short = tracks.map(shortenTrackName).filter(Boolean);
        if (short.length === 0) return '';
        return '[' + short.join('/') + '] ';
    }

    /**
     * Joins track names for the Google Calendar location field.
     * Returns null when there are no tracks, so the caller can fall back to
     * the default event location.
     */
    function buildLocationFromTracks(tracks) {
        if (!tracks || tracks.length === 0) return null;
        const cleaned = tracks.map(t => t.trim()).filter(Boolean);
        return cleaned.length > 0 ? cleaned.join(', ') : null;
    }

    /**
     * Builds a multi-line description for the calendar event.
     * Uses plain \n separators; the ICS builder escapes them per RFC 5545,
     * and Google Calendar's "details" param preserves them through
     * URLSearchParams encoding.
     */
    function buildDescription(speakers, tracks, detailsUrl) {
        const parts = [];
        if (speakers && speakers.length > 0) {
            parts.push('Speakers: ' + speakers.join(', '));
        }
        if (tracks && tracks.length > 0) {
            parts.push('Track: ' + tracks.join(', '));
        }
        if (detailsUrl) {
            parts.push('More info: ' + detailsUrl);
        }
        return parts.join('\n');
    }

    // --- Helpers -------------------------------------------------------------

    /**
     * Formats a Date object as a Google Calendar UTC string (YYYYMMDDTHHMMSSZ).
     */
    function formatGoogleCalendarDate(date) {
        const pad = n => n.toString().padStart(2, '0');
        return date.getUTCFullYear().toString()
             + pad(date.getUTCMonth() + 1)
             + pad(date.getUTCDate())
             + 'T'
             + pad(date.getUTCHours())
             + pad(date.getUTCMinutes())
             + pad(date.getUTCSeconds())
             + 'Z';
    }

    /**
     * Builds a Google Calendar "render" URL for the event.
     * @param {string}      location     If null/empty, falls back to EVENT_LOCATION.
     * @param {string}      description  Multi-line text; newlines will be preserved.
     */
    function buildCalendarUrl(title, startTime, endTime, description, location) {
        const params = new URLSearchParams({
            action:   'TEMPLATE',
            text:     title,
            dates:    formatGoogleCalendarDate(startTime) + '/' + formatGoogleCalendarDate(endTime),
            details:  description || '',
            location: location && location.trim() ? location : EVENT_LOCATION,
        });
        return 'https://calendar.google.com/calendar/render?' + params.toString();
    }

    /**
     * Creates a styled anchor button. Returns the element; caller sets the href.
     */
    function createButton(text, bgColor, hoverColor, ariaLabel) {
        const a = document.createElement('a');
        a.target      = '_blank';
        a.rel         = 'noopener noreferrer';
        a.textContent = text;
        if (ariaLabel) a.setAttribute('aria-label', ariaLabel);
        Object.assign(a.style, {
            display:         'inline-block',
            padding:         '8px 15px',
            backgroundColor: bgColor,
            color:           '#ffffff',
            textDecoration:  'none',
            borderRadius:    '5px',
            fontSize:        '0.9em',
            textAlign:       'center',
            fontWeight:      'bold',
            transition:      'background-color 0.3s ease, transform 0.1s ease',
            boxShadow:       '0 2px 4px rgba(0,0,0,0.2)',
        });
        a.addEventListener('mouseover', () => {
            a.style.backgroundColor = hoverColor;
            a.style.transform       = 'translateY(-1px)';
        });
        a.addEventListener('mouseout', () => {
            a.style.backgroundColor = bgColor;
            a.style.transform       = 'translateY(0)';
        });
        return a;
    }

    /**
     * Escapes a string for use in an ICS TEXT value (RFC 5545 §3.3.11).
     * Backslashes, commas, semicolons and newlines all need escaping.
     */
    function escapeIcsText(str) {
        if (str == null) return '';
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/\n/g, '\\n')
            .replace(/,/g,  '\\,')
            .replace(/;/g,  '\\;');
    }

    /**
     * Produces a reasonably stable UID for an ICS event based on the session URL
     * and start time. Not cryptographically meaningful — just needs to be unique
     * within a calendar.
     */
    function buildIcsUid(detailsUrl, startTime) {
        const slug = (detailsUrl || 'wceu-2026')
            .replace(/^https?:\/\//, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return slug + '-' + formatGoogleCalendarDate(startTime) + '@wceu2026';
    }

    /**
     * Builds an RFC 5545 compliant VCALENDAR/VEVENT string for a single event.
     * Uses UTC times (ending in Z) so no VTIMEZONE block is required.
     * Returns only the VEVENT block when `wrap` is false (for batching).
     */
    function buildIcsEvent(title, startTime, endTime, description, location, detailsUrl) {
        const dtStamp = formatGoogleCalendarDate(new Date());
        const uid     = buildIcsUid(detailsUrl, startTime);

        return [
            'BEGIN:VEVENT',
            'UID:' + uid,
            'DTSTAMP:' + dtStamp,
            'DTSTART:' + formatGoogleCalendarDate(startTime),
            'DTEND:'   + formatGoogleCalendarDate(endTime),
            'SUMMARY:' + escapeIcsText(title),
            'DESCRIPTION:' + escapeIcsText(description || ''),
            'LOCATION:' + escapeIcsText(location && location.trim() ? location : EVENT_LOCATION),
            'URL:' + detailsUrl,
            'END:VEVENT',
        ];
    }

    /**
     * Wraps one or more event line-arrays in a VCALENDAR envelope.
     * Returns the full RFC 5545 string with CRLF line endings.
     */
    function wrapIcsCalendar(eventLineArrays) {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Andras Guseo//WCEU 2026 to Calendar//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
        ];
        eventLineArrays.forEach(ev => lines.push.apply(lines, ev));
        lines.push('END:VCALENDAR');
        return lines.join('\r\n') + '\r\n';
    }

    /**
     * Convenience: build a complete single-event ICS string.
     */
    function buildIcsContent(title, startTime, endTime, description, location, detailsUrl) {
        return wrapIcsCalendar([
            buildIcsEvent(title, startTime, endTime, description, location, detailsUrl),
        ]);
    }

    /**
     * Builds a safe filename for the .ics download from the event title.
     */
    function buildIcsFilename(title) {
        const base = (title || 'event')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 60) || 'event';
        return 'wceu2026-' + base + '.ics';
    }

    /**
     * Creates the pair of calendar buttons (Google + iCal) inside a single
     * container. The container carries CAL_LINK_CLASS so duplicate-injection
     * detection still works.
     */
    function createCalendarButtons(title, startTime, endTime, description, location, detailsUrl, styleOverrides) {
        const wrapper = document.createElement('div');
        wrapper.className = CAL_LINK_CLASS;
        Object.assign(wrapper.style, {
            display:        'flex',
            flexWrap:       'wrap',
            gap:            '8px',
            justifyContent: 'center',
            marginTop:      '10px',
            marginBottom:   '10px',
        }, styleOverrides || {});

        // Google Calendar button.
        const gcalBtn = createButton(
            'Add to Google Calendar',
            '#4285F4',
            '#357ae8',
            'Add "' + title + '" to Google Calendar'
        );
        gcalBtn.href = buildCalendarUrl(title, startTime, endTime, description, location);
        wrapper.appendChild(gcalBtn);

        // iCal / .ics download button.
        // We defer the actual ICS generation + blob URL creation to click-time,
        // so the page doesn't eagerly create 50+ blob URLs that only get revoked
        // on the user's first interaction. Using a <button> (not <a>) since the
        // download is triggered programmatically.
        const icsBtn = document.createElement('button');
        icsBtn.type = 'button';
        icsBtn.textContent = 'Download iCal (.ics)';
        icsBtn.setAttribute('aria-label', 'Download "' + title + '" as an iCal .ics file');
        Object.assign(icsBtn.style, {
            display:         'inline-block',
            padding:         '8px 15px',
            backgroundColor: 'rgb(217, 119, 6)',
            color:           '#ffffff',
            border:          'none',
            borderRadius:    '5px',
            fontSize:        '0.9em',
            fontWeight:      'bold',
            cursor:          'pointer',
            textAlign:       'center',
            transition:      'background-color 0.3s ease, transform 0.1s ease',
            boxShadow:       '0 2px 4px rgba(0,0,0,0.2)',
            fontFamily:      'inherit', // buttons inherit less than anchors across browsers
        });
        icsBtn.addEventListener('mouseover', () => {
            icsBtn.style.backgroundColor = '#b45309';
            icsBtn.style.transform       = 'translateY(-1px)';
        });
        icsBtn.addEventListener('mouseout', () => {
            icsBtn.style.backgroundColor = 'rgb(217, 119, 6)';
            icsBtn.style.transform       = 'translateY(0)';
        });
        icsBtn.addEventListener('click', () => {
            const ics  = buildIcsContent(title, startTime, endTime, description, location, detailsUrl);
            const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = buildIcsFilename(title);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        });
        wrapper.appendChild(icsBtn);

        return wrapper;
    }

    /**
     * Inserts the calendar buttons container into the DOM after `anchorEl`,
     * unless buttons have already been added next to it.
     */
    function insertCalendarLink(anchorEl, wrapper) {
        if (!anchorEl || !anchorEl.parentNode) return false;
        // Skip if this session already has buttons (handles re-runs from observers).
        const next = anchorEl.nextElementSibling;
        if (next && next.classList && next.classList.contains(CAL_LINK_CLASS)) return false;
        anchorEl.parentNode.insertBefore(wrapper, anchorEl.nextSibling);
        return true;
    }

    /**
     * Appends the calendar buttons container as the last child of `containerEl`,
     * unless it already contains a buttons container.
     */
    function appendCalendarLink(containerEl, wrapper) {
        if (!containerEl) return false;
        // Skip if this container already has buttons.
        if (containerEl.querySelector(':scope > .' + CAL_LINK_CLASS)) return false;
        containerEl.appendChild(wrapper);
        return true;
    }

    // --- Schedule page -------------------------------------------------------

    /**
     * Extracts all calendar-relevant metadata from a single
     * .wordcamp-schedule__session element. Returns null if mandatory fields
     * (title, times) can't be found.
     */
    function extractSessionData(session) {
        const titleEl = session.querySelector('.wordcamp-schedule__session-title');
        if (!titleEl) return null;

        const titleLink = titleEl.querySelector('a');
        const titleText = (titleLink ? titleLink.textContent : titleEl.textContent).trim();
        if (!titleText) return null;
        const detailsUrl = titleLink ? titleLink.href : window.location.href;

        const tracks = [];
        session.querySelectorAll('.wordcamp-schedule__session-tracks dd').forEach(dd => {
            dd.textContent.split(',').forEach(part => {
                const name = part.trim();
                if (name) tracks.push(name);
            });
        });

        const speakers = [];
        session.querySelectorAll('.wordcamp-schedule__session-speakers dd').forEach(dd => {
            dd.textContent.split(',').forEach(part => {
                const name = part.trim();
                if (name) speakers.push(name);
            });
        });

        let times = parseGridAreaTimes(session.getAttribute('style'));
        if (!times) times = parseTextTimes(session);
        if (!times) return null;

        return {
            titleText,
            detailsUrl,
            tracks,
            speakers,
            startTime: times.startTime,
            endTime:   times.endTime,
        };
    }

    /**
     * Returns all .wordcamp-schedule__session elements the user has marked
     * as favourite (star button with aria-pressed="true").
     */
    function getFavouriteSessions() {
        const favs = [];
        document.querySelectorAll('.wordcamp-schedule__session').forEach(session => {
            const btn = session.querySelector('.fav-session-button');
            if (btn && btn.getAttribute('aria-pressed') === 'true') favs.push(session);
        });
        return favs;
    }

    /**
     * Builds a multi-event ICS string from an array of session data objects.
     */
    function buildFavouritesIcs(sessionDatas) {
        const events = sessionDatas.map(s => {
            const prefix      = buildTitlePrefix(s.tracks);
            const location    = buildLocationFromTracks(s.tracks);
            const description = buildDescription(s.speakers, s.tracks, s.detailsUrl);
            return buildIcsEvent(
                prefix + s.titleText,
                s.startTime,
                s.endTime,
                description,
                location,
                s.detailsUrl
            );
        });
        return wrapIcsCalendar(events);
    }

    /**
     * Creates (once) a floating "Export favourites" button on the schedule
     * page, visible only when the user has at least one favourite.
     */
    function ensureFavouritesExportButton() {
        let btn = document.getElementById('wc-gcal-export-favs');
        if (btn) return btn;

        btn = document.createElement('button');
        btn.id = 'wc-gcal-export-favs';
        btn.type = 'button';
        btn.textContent = 'Export favourites (.ics)';
        btn.setAttribute('aria-label', 'Download all favourited sessions as an iCal .ics file');
        Object.assign(btn.style, {
            position:        'fixed',
            right:           '160px',
            bottom:          '20px',
            zIndex:          '9999',
            padding:         '10px 18px',
            backgroundColor: '#d97706', // warm orange — clearly distinct from the per-session buttons
            color:           '#ffffff',
            border:          'none',
            borderRadius:    '8px',
            fontSize:        '0.75em',
            fontWeight:      'bold',
            cursor:          'pointer',
            boxShadow:       '0 4px 12px rgba(0,0,0,0.25)',
            transition:      'background-color 0.2s ease, transform 0.1s ease',
            display:         'none', // shown when favourites exist
        });
        btn.addEventListener('mouseover', () => {
            btn.style.backgroundColor = '#b45309';
            btn.style.transform       = 'translateY(-1px)';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.backgroundColor = '#d97706';
            btn.style.transform       = 'translateY(0)';
        });

        btn.addEventListener('click', () => {
            const favEls = getFavouriteSessions();
            const datas = favEls
                .map(extractSessionData)
                .filter(Boolean);
            if (datas.length === 0) {
                alert('No favourite sessions found. Click the star icon next to a session to favourite it first.');
                return;
            }
            const ics  = buildFavouritesIcs(datas);
            const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = 'wceu2026-favourites.ics';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        });

        document.body.appendChild(btn);
        return btn;
    }

    /**
     * Updates the floating button's visibility (and count) based on the
     * current number of favourited sessions.
     */
    function updateFavouritesButton() {
        const btn = ensureFavouritesExportButton();
        const count = getFavouriteSessions().length;
        if (count === 0) {
            btn.style.display = 'none';
        } else {
            btn.style.display = 'inline-block';
            btn.textContent = 'Export ' + count + ' favourite' + (count === 1 ? '' : 's') + ' (.ics)';
        }
    }

    /**
     * Parses the grid-area style used by the schedule plugin on WCEU 2026,
     * e.g. "time-060945 / wordcamp-schedule-track-48 / time-061015", and
     * returns { startTime, endTime } as UTC Date objects, or null if the
     * values can't be read.
     *
     * Time tokens are "time-DDHHMM" (day, hour, minute). The month is
     * implicit (EVENT_MONTH) because the event is confined to one month.
     */
    function parseGridAreaTimes(gridAreaValue) {
        if (!gridAreaValue) return null;

        // Grid-area can be a single value or slash-separated. Pull out all
        // "time-xxxxxx" tokens regardless of position/order.
        const tokens = gridAreaValue.match(/time-(\d{6})/g);
        if (!tokens || tokens.length === 0) return null;

        const toDate = token => {
            const digits = token.replace('time-', '');
            const day    = parseInt(digits.slice(0, 2), 10);
            const hour   = parseInt(digits.slice(2, 4), 10);
            const minute = parseInt(digits.slice(4, 6), 10);
            if ([day, hour, minute].some(isNaN)) return null;
            // Convert CEST wall-clock to UTC by subtracting the offset.
            return new Date(Date.UTC(
                EVENT_YEAR,
                EVENT_MONTH - 1,
                day,
                hour - EVENT_TZ_OFFSET_HOURS,
                minute
            ));
        };

        const startTime = toDate(tokens[0]);
        const endTime   = tokens.length > 1 ? toDate(tokens[1]) : null;
        if (!startTime || isNaN(startTime.getTime())) return null;

        if (!endTime || isNaN(endTime.getTime())) {
            return {
                startTime,
                endTime: new Date(startTime.getTime() + DEFAULT_DURATION_MIN * 60 * 1000),
            };
        }
        return { startTime, endTime };
    }

    /**
     * Fallback time parser for sessions where grid-area is missing/unreadable.
     * Reads the "09:45 - 10:15" style text inside the session's <p> tag, but
     * needs a reference date — which we try to read from any ancestor carrying
     * a data-date attribute, or from a sibling "time-MMDDHHMM" token on
     * another session in the same day column.
     */
    function parseTextTimes(session) {
        // Direct-child <p> only. The session markup has the time in an immediate
        // <p> child; a descendant query risks grabbing unrelated paragraphs if
        // the plugin ever adds them (e.g. a "Coming soon" blurb).
        const p = session.querySelector(':scope > p');
        if (!p) return null;
        const text = p.textContent.trim();
        const m = text.match(/(\d{1,2}):(\d{2})(?:\s*[–-]\s*(\d{1,2}):(\d{2}))?/);
        if (!m) return null;

        // Try to find a date from any nearby grid-area token.
        let refDate = null;
        const sibling = session.parentElement
            ? session.parentElement.querySelector('[style*="time-"]')
            : null;
        if (sibling) {
            const parsed = parseGridAreaTimes(sibling.getAttribute('style'));
            if (parsed) refDate = parsed.startTime;
        }
        if (!refDate) return null;

        const startHour = parseInt(m[1], 10);
        const startMin  = parseInt(m[2], 10);
        const endHour   = m[3] ? parseInt(m[3], 10) : null;
        const endMin    = m[4] ? parseInt(m[4], 10) : null;

        const startTime = new Date(Date.UTC(
            refDate.getUTCFullYear(),
            refDate.getUTCMonth(),
            refDate.getUTCDate(),
            startHour - EVENT_TZ_OFFSET_HOURS,
            startMin
        ));
        const endTime = (endHour !== null)
            ? new Date(Date.UTC(
                refDate.getUTCFullYear(),
                refDate.getUTCMonth(),
                refDate.getUTCDate(),
                endHour - EVENT_TZ_OFFSET_HOURS,
                endMin
              ))
            : new Date(startTime.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);

        return { startTime, endTime };
    }

    /**
     * Processes every session currently rendered on the schedule page.
     * Safe to call repeatedly — already-processed sessions are skipped.
     */
    function processScheduleSessions() {
        const sessions = document.querySelectorAll('.wordcamp-schedule__session');
        let added = 0;

        sessions.forEach(session => {
            // Skip if we've already injected a button for this session.
            if (session.querySelector('.' + CAL_LINK_CLASS)) return;

            const data = extractSessionData(session);
            if (!data) {
                // Only warn when there's a title but we couldn't get times — silent skip otherwise.
                const titleEl = session.querySelector('.wordcamp-schedule__session-title');
                if (titleEl) {
                    console.warn('[WCEU26 → GCal] Could not build calendar entry for session:', titleEl.textContent.trim());
                }
                return;
            }

            const prefix      = buildTitlePrefix(data.tracks);
            const location    = buildLocationFromTracks(data.tracks);
            const description = buildDescription(data.speakers, data.tracks, data.detailsUrl);

            const link = createCalendarButtons(
                prefix + data.titleText,
                data.startTime,
                data.endTime,
                description,
                location,
                data.detailsUrl
            );
            if (appendCalendarLink(session, link)) added++;
        });

        // Refresh the bulk-export button visibility/count on every pass so it
        // stays in sync with the user toggling favourites.
        updateFavouritesButton();

        return added;
    }

    /**
     * Finds the smallest container that holds all currently-rendered schedule
     * sessions. Returns null if no sessions are on the page yet.
     *
     * The session elements themselves live in a CSS grid, so their common
     * ancestor is the grid container — scoping the MutationObserver there
     * avoids re-running the processor on unrelated page activity (nav menu
     * hovers, search typing, cookie banners, etc.).
     */
    function findScheduleContainer() {
        const first = document.querySelector('.wordcamp-schedule__session');
        if (!first) return null;
        // The grid container is typically .wordcamp-schedule or similar. Walk
        // up from the first session until we find an element whose class name
        // starts with "wordcamp-schedule" — that's our grid.
        let node = first.parentElement;
        while (node && node !== document.body) {
            if (node.className && typeof node.className === 'string' &&
                /\bwordcamp-schedule(\b|__)/.test(node.className)) {
                return node;
            }
            node = node.parentElement;
        }
        // Fallback: the first session's direct parent.
        return first.parentElement;
    }

    /**
     * Watches for the schedule grid to appear (the page initially renders
     * "Loading…" and fills in sessions via JS) and processes sessions as
     * they show up. Also re-runs on later DOM mutations so day-switching
     * or filter changes re-populate the buttons.
     */
    function watchScheduleForSessions() {
        // Process whatever's already there.
        processScheduleSessions();

        // Coalesce rapid mutations (initial render, filter toggles, etc.) into
        // a single processing pass per animation frame. Without this the
        // observer re-runs on every button we ourselves insert, which creates
        // O(mutations × sessions) work.
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                processScheduleSessions();
                // Once sessions exist, switch from the wide document-body
                // observer to one scoped to the schedule container.
                maybeRebindObserver();
            });
        };

        let observer = new MutationObserver(schedule);
        let observedTarget = document.body;
        observer.observe(observedTarget, { childList: true, subtree: true });

        function maybeRebindObserver() {
            if (observedTarget !== document.body) return; // already scoped
            const container = findScheduleContainer();
            if (!container || container === document.body) return;
            observer.disconnect();
            observer = new MutationObserver(schedule);
            observer.observe(container, { childList: true, subtree: true });
            observedTarget = container;
        }

        // The favourite-star button toggles aria-pressed without adding DOM
        // nodes, so the observer above sometimes misses it. Listen at the
        // document level (event bubbles up) and refresh the bulk button after
        // the plugin has handled the click.
        document.addEventListener('click', e => {
            const target = e.target;
            if (target && target.closest && target.closest('.fav-session-button')) {
                // Defer so the plugin's own click handler flips aria-pressed first.
                setTimeout(updateFavouritesButton, 0);
            }
        }, true);

        // Safety net: poll for up to ~30s in case the observer misses a late
        // render (e.g. schedule injected inside an iframe or shadow root).
        let ticks = 0;
        const interval = setInterval(() => {
            ticks++;
            processScheduleSessions();
            maybeRebindObserver();
            if (ticks >= 30) clearInterval(interval);
        }, 1000);
    }

    // --- Individual session page --------------------------------------------

    function processSessionPage() {
        const titleElement         = document.querySelector('.wp-block-post-title');
        const sessionDateContainer = document.querySelector('.wp-block-wordcamp-session-date');
        const dateTimeElement      = sessionDateContainer ? sessionDateContainer.querySelector('time') : null;

        if (!titleElement || !sessionDateContainer || !dateTimeElement) {
            console.warn('[WCEU26 → GCal] Session page: missing title or date/time element.');
            return;
        }

        // We want the buttons to sit at the very bottom of the "Session Info" block.
        // That block is the 4th ancestor of .wp-block-wordcamp-session-date (the
        // great-great-grandparent), and is itself a .wp-block-group. We can't rely
        // on the hashed layout class that WordPress generates (it changes between
        // builds), so we walk up the tree and verify.
        let sessionInfoContainer = sessionDateContainer;
        for (let i = 0; i < 4 && sessionInfoContainer; i++) {
            sessionInfoContainer = sessionInfoContainer.parentElement;
        }
        const useContainer = sessionInfoContainer &&
            sessionInfoContainer.classList.contains('wp-block-group');

        // Early exit if buttons are already present (either inside the target
        // container, or at the legacy insertion point next to the date element).
        if (useContainer && sessionInfoContainer.querySelector(':scope > .' + CAL_LINK_CLASS)) return;
        const next = sessionDateContainer.nextElementSibling;
        if (next && next.classList && next.classList.contains(CAL_LINK_CLASS)) return;

        // Use textContent rather than innerText: innerText reflects CSS (including
        // text-transform: uppercase on the title), which would corrupt the event name.
        const titleText = titleElement.textContent.trim();
        const dateTimeAttr = dateTimeElement.getAttribute('datetime'); // e.g. "2026-06-05T09:30:00+02:00"
        if (!dateTimeAttr) {
            console.warn('[WCEU26 → GCal] Session page: <time> has no datetime attribute.');
            return;
        }

        // The ISO string already encodes the timezone offset, so Date handles it natively.
        const startTime = new Date(dateTimeAttr);
        if (isNaN(startTime.getTime())) {
            console.error('[WCEU26 → GCal] Could not parse datetime:', dateTimeAttr);
            return;
        }

        // Try to extract an explicit end time from the visible text, e.g.
        // "Friday 9:30 AM - 10:00 AM CEST" or "Friday 9:30 - 10:00 CEST".
        // If none is present, fall back to DEFAULT_DURATION_MIN.
        const timeText = dateTimeElement.textContent.trim();
        const rangeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);

        let endTime;
        if (rangeMatch) {
            let endHour = parseInt(rangeMatch[4], 10);
            const endMin = parseInt(rangeMatch[5], 10);
            const endMeridiem = (rangeMatch[6] || rangeMatch[3] || '').toUpperCase();
            if (endMeridiem === 'PM' && endHour < 12) endHour += 12;
            if (endMeridiem === 'AM' && endHour === 12) endHour = 0;

            // Use the same calendar date as the start time, shifted by the start's UTC offset.
            // Easiest: build the end time in the event's local timezone, then subtract the offset.
            endTime = new Date(Date.UTC(
                startTime.getUTCFullYear(),
                startTime.getUTCMonth(),
                startTime.getUTCDate(),
                endHour - EVENT_TZ_OFFSET_HOURS,
                endMin
            ));
            // Guard against parse weirdness (e.g. event crosses midnight).
            if (endTime <= startTime) {
                endTime = new Date(startTime.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
            }
        } else {
            endTime = new Date(startTime.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
        }

        // Extract tracks from the "taxonomy-wcb_track" terms block.
        // Markup: <div class="taxonomy-wcb_track wp-block-post-terms">
        //           <a>Track 1</a><span>, </span><a>Track 2</a>...
        //         </div>
        const tracks = [];
        document.querySelectorAll('.taxonomy-wcb_track a').forEach(a => {
            const name = a.textContent.trim();
            if (name) tracks.push(name);
        });

        // Extract speakers from .wp-block-wordcamp-session-speakers.
        // Markup uses <span class="wp-block-wordcamp-session-speakers__name"><a>Name</a></span>
        // repeated for each speaker. Fall back to the span's textContent if no <a>.
        const speakers = [];
        document.querySelectorAll('.wp-block-wordcamp-session-speakers__name').forEach(el => {
            const a = el.querySelector('a');
            const name = (a ? a.textContent : el.textContent).trim();
            if (name) speakers.push(name);
        });

        const prefix      = buildTitlePrefix(tracks);
        const location    = buildLocationFromTracks(tracks);
        const description = buildDescription(speakers, tracks, window.location.href);

        const link = createCalendarButtons(
            prefix + titleText,
            startTime,
            endTime,
            description,
            location,
            window.location.href,
            { marginTop: '2.5rem', marginBottom: '0' }
        );
        if (useContainer) {
            appendCalendarLink(sessionInfoContainer, link);
        } else {
            // Fallback: the 4 levels up didn't land on a .wp-block-group, so the
            // page markup has changed. Insert next to the date element instead,
            // which is what earlier versions did, so we still show buttons.
            console.warn('[WCEU26 → GCal] Expected Session Info container not found; using fallback position.');
            insertCalendarLink(sessionDateContainer, link);
        }
    }

    // --- Router --------------------------------------------------------------

    const path = window.location.pathname;
    if (path.endsWith('/2026/schedule/') || path.endsWith('/2026/schedule')) {
        watchScheduleForSessions();
    } else if (path.includes('/2026/session/')) {
        processSessionPage();
    }
})();
