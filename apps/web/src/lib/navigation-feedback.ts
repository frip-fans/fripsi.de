// How long a navigation may run before it is allowed to say it is waiting.
// Measured navigations on this site resolve well inside it, so they stay
// instant; a slower one then starts the progress indicator and the page shade
// at the same moment rather than telling the reader to wait twice.
export const NAVIGATION_FEEDBACK_DELAY_MS = 250;
