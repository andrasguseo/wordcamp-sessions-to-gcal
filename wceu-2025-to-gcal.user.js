// ==UserScript==
// @name         WordCamp Europe 2025 Schedule to Google Calendar
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Adds "Add to Google Calendar" links for each session on WordCamp Europe 2025 schedule and individual session pages.
// @author       Andras Guseo, Gemini
// @homepage     https://andrasguseo.com
// @source       https://github.com/andrasguseo/wordcamp-sessions-to-gcal/raw/refs/heads/main/wceu-2025-to-gcal.user.js
// @match        https://europe.wordcamp.org/2025/schedule/
// @match        https://europe.wordcamp.org/2025/session/*
// @grant        none
// @run-at       document-end // Ensure script runs after the DOM is loaded
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Formats a Date object into a Google Calendar compatible UTC string (YYYYMMDDTHHMMSSZ).
     * @param {Date} date - The Date object to format.
     * @returns {string} The formatted date string.
     */
    function formatGoogleCalendarDate(date) {
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    }

    /**
     * Creates and appends the "Add to Google Calendar" link to the specified element.
     * @param {string} title - The event title (already URI encoded).
     * @param {Date} startTime - The start time of the event (UTC Date object).
     * @param {Date} endTime - The end time of the event (UTC Date object).
     * @param {HTMLElement} appendAfterElement - The DOM element after which the link should be inserted.
     */
    function createAndAppendCalendarLink(title, startTime, endTime, appendAfterElement) {
        const formattedStartTime = formatGoogleCalendarDate(startTime);
        const formattedEndTime = formatGoogleCalendarDate(endTime);

        const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
                            `&text=${title}` +
                            `&dates=${formattedStartTime}/${formattedEndTime}` +
                            `&details=${encodeURIComponent('More info: ' + window.location.href)}` +
                            `&location=${encodeURIComponent('WordCamp Europe 2025')}`;

        const calendarLink = document.createElement('a');
        calendarLink.href = calendarUrl;
        calendarLink.target = '_blank'; // Open in a new tab
        calendarLink.textContent = 'Add to Google Calendar';

        // Apply styling
        calendarLink.style.display = 'block';
        calendarLink.style.marginTop = '10px';
        calendarLink.style.padding = '8px 15px';
        calendarLink.style.backgroundColor = '#4285F4'; // Google blue
        calendarLink.style.color = '#ffffff';
        calendarLink.style.textDecoration = 'none';
        calendarLink.style.borderRadius = '5px';
        calendarLink.style.fontSize = '0.9em';
        calendarLink.style.textAlign = 'center';
        calendarLink.style.fontWeight = 'bold';
        calendarLink.style.transition = 'background-color 0.3s ease, transform 0.1s ease';
        calendarLink.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        calendarLink.style.maxWidth = '250px';
        calendarLink.style.marginRight = 'auto';
        calendarLink.style.marginLeft = 'auto';

        // Add hover effects
        calendarLink.onmouseover = function() {
            this.style.backgroundColor = '#357ae8';
            this.style.transform = 'translateY(-1px)';
        };
        calendarLink.onmouseout = function() {
            this.style.backgroundColor = '#4285F4';
            this.style.transform = 'translateY(0)';
        };

        if (appendAfterElement && appendAfterElement.parentNode) {
            appendAfterElement.parentNode.insertBefore(calendarLink, appendAfterElement.nextSibling);
        } else {
            console.error('Could not append calendar link: target element or its parent not found.');
        }
    }

    // Main execution logic for the Tampermonkey script
    // The @run-at document-end directive in the header ensures this runs
    // after the DOM is largely available.

    // --- Logic for Main Schedule Page ---
    if (window.location.pathname.includes('/schedule/')) {
        const dailySchedules = document.querySelectorAll('.wordcamp-schedule');

        dailySchedules.forEach(dailySchedule => {
            const dateElement = dailySchedule.querySelector('.wordcamp-schedule__date');
            if (!dateElement) {
                console.warn('Could not find date element for a daily schedule block. Skipping.');
                return;
            }

            const dateText = dateElement.innerText.trim();
            let eventDate;
            try {
                let monthName, day, year;
                const parts = dateText.split(', ');

                if (parts.length === 3) { // Format: "DayOfWeek, Month Day, Year"
                    const monthDay = parts[1].split(' ');
                    monthName = monthDay[0];
                    day = parseInt(monthDay[1], 10);
                    year = parseInt(parts[2], 10);
                } else if (parts.length === 2) { // Format: "Month Day, Year"
                    const monthDay = parts[0].split(' ');
                    monthName = monthDay[0];
                    day = parseInt(monthDay[1], 10);
                    year = parseInt(parts[1], 10);
                } else {
                    console.error('Unexpected date format (too many/few commas):', dateText);
                    return;
                }

                const monthNames = ["January", "February", "March", "April", "May", "June",
                                    "July", "August", "September", "October", "November", "December"];
                const month = monthNames.indexOf(monthName);

                if (month !== -1 && !isNaN(day) && !isNaN(year)) {
                    eventDate = new Date(year, month, day);
                } else {
                    console.error('Failed to parse date parts (month, day, or year invalid):', dateText);
                    return;
                }
            } catch (e) {
                console.error('Error during date parsing:', dateText, e);
                return;
            }

            if (!eventDate || isNaN(eventDate.getTime())) {
                console.warn('Invalid date object created for schedule block:', dateText);
                return;
            }

            const currentYear = eventDate.getFullYear();
            const currentMonth = eventDate.getMonth();
            const currentDay = eventDate.getDate();

            const sessions = dailySchedule.querySelectorAll('.wordcamp-schedule__session');

            sessions.forEach(session => {
                const titleElement = session.querySelector('.wordcamp-schedule__session-title');
                const timeElement = session.querySelector('p');

                if (titleElement && timeElement) {
                    const title = encodeURIComponent(titleElement.innerText.trim());
                    const timeText = timeElement.innerText.trim();

                    let startTime, endTime;
                    let startHour, startMinute, endHour, endMinute;

                    const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*(?:[–-]\s*(\d{1,2}:\d{2}))?\s*(CEST)?/i);

                    if (timeMatch) {
                        const startStr = timeMatch[1];
                        const endStr = timeMatch[2];

                        [startHour, startMinute] = startStr.split(':').map(Number);

                        if (endStr) {
                            [endHour, endMinute] = endStr.split(':').map(Number);
                        } else {
                            endHour = startHour + 1;
                            endMinute = startMinute;
                            if (endHour >= 24) {
                                endHour -= 24;
                            }
                        }

                        // CEST (UTC+2) -> UTC: subtract 2 hours
                        startTime = new Date(Date.UTC(currentYear, currentMonth, currentDay, startHour - 2, startMinute));
                        endTime = new Date(Date.UTC(currentYear, currentMonth, currentDay, endHour - 2, endMinute));

                        if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
                            createAndAppendCalendarLink(title, startTime, endTime, timeElement);
                        } else {
                            console.warn('Could not parse start/end time for session:', titleElement.innerText, 'Time text:', timeText);
                        }
                    } else {
                        console.warn('Could not extract time string from session:', titleElement.innerText, 'Time text:', timeText);
                    }
                }
            });
        });
    }
    // --- Logic for Individual Session Page ---
    else if (window.location.pathname.includes('/session/')) {
        const titleElement = document.querySelector('.wp-block-post-title');
        const sessionDateContainer = document.querySelector('.wp-block-wordcamp-session-date'); // Target the container div
        const dateTimeElement = sessionDateContainer ? sessionDateContainer.querySelector('time') : null; // Get the time tag within it

        if (titleElement && sessionDateContainer && dateTimeElement) {
            const title = encodeURIComponent(titleElement.innerText.trim());
            const dateTimeAttr = dateTimeElement.getAttribute('datetime'); // e.g., "2025-06-06T10:00:00+02:00" or "2025-06-06T10:00:00"

            if (dateTimeAttr) {
                // Parse the datetime attribute. This will handle timezone offsets if present (like +02:00).
                let startTime = new Date(dateTimeAttr);

                // Now, parse the end time from the text content of the <time> tag
                const timeText = dateTimeElement.innerText.trim(); // e.g., "June 6, 2025 at 10:00 - 11:00 CEST"
                const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(CEST)?/i);

                let endTime;
                if (timeMatch && timeMatch[2]) { // If an explicit end time like "10:00 - 11:00" is found
                    const endStr = timeMatch[2];
                    const [endHour, endMinute] = endStr.split(':').map(Number);

                    // Reconstruct the end time using the same date (UTC components) as the start time
                    // and apply the CEST offset if needed for correct UTC calculation.
                    // The `startTime` already correctly handles the UTC conversion if `datetime` had an offset.
                    // So we use its UTC date components and then apply the desired end time and CEST offset.
                    endTime = new Date(Date.UTC(
                        startTime.getUTCFullYear(),
                        startTime.getUTCMonth(),
                        startTime.getUTCDate(),
                        endHour - 2, // Assuming CEST and converting to UTC
                        endMinute
                    ));
                } else {
                    // If no explicit end time in the text, assume 1-hour duration from parsed start time
                    endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // Add 1 hour in milliseconds
                }

                if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
                    // Pass the parent container (sessionDateContainer) to append after it
                    createAndAppendCalendarLink(title, startTime, endTime, sessionDateContainer);
                } else {
                    console.error('Failed to parse date/time for single session page. Datetime attr:', dateTimeAttr, 'Time text:', timeText);
                }
            } else {
                console.warn('Could not find datetime attribute on time tag for single session. Skipping.');
            }
        } else {
            console.warn('Could not find title or date/time element for single session page. Skipping.');
        }
    }
})();
