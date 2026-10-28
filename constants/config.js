export const GOOGLE_MAPS_API_KEY = "AIzaSyAbaQ3ldMRUYmxt39TdasRdU-rtPLyZVhc";

// Socket.IO server URL (same as API server by default)
// Production: "https://claimsmitra-backend-production.up.railway.app"
// export const SOCKET_URL = "http://192.168.1.13:3000";
export const SOCKET_URL = "https://inspection.claimsmitra.com";


// API Configuration
// Production: "https://claimsmitra-backend-production.up.railway.app/api/v1"
// export const API_BASE_URL = "http://192.168.1.13:3000/api/v1";
export const API_BASE_URL = "https://inspection.claimsmitra.com/backend/api/v1";

/**
 * Build a full URL for a media/upload path returned by the backend.
 *
 * Uploads are NOT served under the API prefix — the backend mounts them at
 * '/uploads' on the bare host, and serves the same API under both '/api/v1' and
 * its '/backend' alias. So whichever prefix API_BASE_URL carries has to come off.
 *
 * Already-absolute URLs (http…) are returned unchanged, and a missing path
 * returns '' rather than a "…undefined" URL.
 *
 * ALWAYS use this instead of hand-rolling `API_BASE_URL.replace(...)` at the call
 * site — that pattern used to be duplicated in 16 places, so a base-URL change
 * meant 16 edits and any one missed silently broke that screen's images.
 */
export const getMediaUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${API_BASE_URL.replace(/\/(api\/v1|backend)\/?$/, '')}${path}`;
};

// Socket.IO server URL (same as API server by default)
// Production: "https://claimsmitra-backend-production.up.railway.app"
// export const SOCKET_URL = "https://claimsmitra-backend-production.up.railway.app";

// API Configuration
// Production: "https://claimsmitra-backend-production.up.railway.app/api/v1"
// export const API_BASE_URL = "https://claimsmitra-backend-production.up.railway.app/api/v1";

// Surveyor licence categories — values must stay in sync with the backend enum.
// Note: `is_investigator` is a baseline capability, NOT a category.
export const CATEGORY_LABELS = {
  motor: 'Motor',
  marine: 'Marine',
  fire: 'Fire',
  engineering: 'Engineering',
  miscellaneous: 'Miscellaneous',
  lop: 'LOP',
  hull: 'Hull',
  aviation: 'Aviation',
};
export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
export const categoryLabel = (c) => CATEGORY_LABELS[c] || c;
