// ==UserScript==
// @name         WordCamp US 2025 Sessions to Google Calendar
// @namespace    http://tampermonkey.net/
// @version      0.19
// @description  Adds an "Add to Google Calendar" link to individual WordCamp US 2025 session pages.
// @author       Andras Guseo, Gemini
// @homepage     https://andrasguseo.com
// @source       https://github.com/andrasguseo/wordcamp-sessions-to-gcal/raw/refs/heads/main/wcus-2025-to-gcal.user.js
// @match        https://us.wordcamp.org/2025/session/*
// @grant        none
// @run-at       document-end // Ensure script runs after the DOM is loaded
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Creates and appends the "Add to Google Calendar" link to the specified element.
     * @param {string} title - The event title (already URI encoded).
     * @param {string} localStartTime - The start time of the event as a local time string (e.g., "20250606T100000").
     * @param {string} localEndTime - The end time of the event as a local time string (e.g., "20250606T104500").
     * @param {string} timeZone - The IANA time zone identifier (e.g., "America/Los_Angeles").
     * @param {string} location - The location of the session.
     * @param {string} speakers - The names of the speakers.
     * @param {HTMLElement} appendAfterElement - The DOM element after which the link should be inserted.
     */
    function createAndAppendCalendarLink(title, localStartTime, localEndTime, timeZone, location, speakers, appendAfterElement) {
        let details = '';
        if (speakers) {
            details += 'Presented by: ' + speakers + '\n\n';
        }
        details += 'More info: ' + window.location.href;

        const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
                            `&text=${title}` +
                            `&dates=${localStartTime}/${localEndTime}` +
                            `&ctz=${encodeURIComponent(timeZone)}` +
                            `&details=${encodeURIComponent(details)}` +
                            `&location=${encodeURIComponent(location)}`;

        const calendarLink = document.createElement('a');
        calendarLink.href = calendarUrl;
        calendarLink.target = '_blank';
        calendarLink.textContent = 'Add to Google Calendar';

        calendarLink.onclick = function(event) {
            event.stopPropagation();
            event.preventDefault();
            window.open(calendarUrl, '_blank').focus();
        };

        calendarLink.style.display = 'block';
        calendarLink.style.marginTop = '10px';
        calendarLink.style.padding = '8px 15px';
        calendarLink.style.backgroundColor = '#4285F4';
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

    // Main execution logic for the Tampermonkey script on session pages
    const titleElement = document.querySelector('.wp-block-post-title');
    const sessionDateContainer = document.querySelector('.wp-block-wordcamp-session-date');
    const dateTimeElement = sessionDateContainer ? sessionDateContainer.querySelector('time') : null;
    const locationElement = document.querySelector('.taxonomy-wcb_track a');
    const speakerElement = document.querySelector('.wp-block-wordcamp-session-speakers__name a');

    if (titleElement && sessionDateContainer && dateTimeElement) {
        const title = encodeURIComponent(titleElement.innerText.trim());
        const dateTimeAttr = dateTimeElement.getAttribute('datetime');
        const locationName = locationElement ? locationElement.innerText.trim() : 'WordCamp US 2025';

        // Extract speaker name
        const speakerName = speakerElement ? speakerElement.innerText.trim() : '';

        if (dateTimeAttr) {
            // Extract the local date and time components from the datetime attribute string
            const localDate = dateTimeAttr.substring(0, 10).replace(/-/g, ''); // YYYYMMDD
            const startHour = parseInt(dateTimeAttr.substring(11, 13), 10);
            const startMinute = parseInt(dateTimeAttr.substring(14, 16), 10);

            // Calculate end time by adding 45 minutes to the local time
            let endHour = startHour;
            let endMinute = startMinute + 45;

            // Handle minute overflow
            if (endMinute >= 60) {
                endMinute -= 60;
                endHour += 1;
            }

            // Handle hour overflow
            if (endHour >= 24) {
                 endHour = endHour - 24;
            }

            // Format the local date and time to the required Google Calendar string format
            const localStartTimeStr = `${localDate}T${String(startHour).padStart(2, '0')}${String(startMinute).padStart(2, '0')}00`;
            const localEndTimeStr = `${localDate}T${String(endHour).padStart(2, '0')}${String(endMinute).padStart(2, '0')}00`;

            // Determine the correct IANA time zone identifier
            const timeZone = 'America/Los_Angeles';

            if (timeZone) {
                createAndAppendCalendarLink(title, localStartTimeStr, localEndTimeStr, timeZone, locationName, speakerName, sessionDateContainer);
            } else {
                console.error('Failed to parse date/time or time zone for single session page.');
            }
        } else {
            console.warn('Could not find datetime attribute on time tag for single session. Skipping.');
        }
    } else {
        console.warn('Could not find title or date/time element for single session page. Skipping.');
    }
})();

