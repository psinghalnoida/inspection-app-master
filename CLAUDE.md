# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Start Expo dev server
npm run android        # Run on Android emulator/device
npm run ios            # Run on iOS simulator/device
npm run web            # Run web version
npm run lint           # Run ESLint (expo rules)
```

No test suite is configured.

**EAS Builds (production/preview):**
```bash
eas build --platform android --profile preview
eas build --platform android --profile production
eas submit --platform android
```

## Architecture

**ClaimsMitra** is a cross-platform React Native (Expo) app for insurance claims survey management with two primary user roles: **Surveyor** and **Assigner**.

### Routing & Role-Based Navigation

Entry point is `app/_layout.jsx`, which reads auth state from AsyncStorage, determines the user's role, and redirects:
- Authenticated surveyors → `/(surveyor-tabs)/` (home, surveys list, profile)
- Authenticated assigners → `/(tabs)/` (home, survey management, profile)
- Unauthenticated users → `/screens/LoginScreen`

File-based routing via Expo Router. The `(tabs)` and `(surveyor-tabs)` groups each have their own `_layout.jsx` defining the bottom tab structure.

### Service Layer (`/lib`)

All backend communication and device integrations are abstracted in `/lib`:

| File | Purpose |
|------|---------|
| `api.js` | Axios instance with base URL, auth token injection, and token refresh interceptor |
| `auth.js` | Login/logout, token storage/retrieval (AsyncStorage), FCM token registration |
| `surveyorService.js` | Surveyor API calls: fetch surveys, submit forms, update location |
| `assignerService.js` | Assigner API calls: assign surveys, view surveyors, manage claims |
| `offlineDb.js` | SQLite wrapper: cache surveys/details, queue pending uploads for retry |
| `socketService.js` | Socket.IO client for real-time location tracking and chat messaging |
| `notifications.js` | Expo Notifications + FCM setup and permission handling |

### Offline Support

On network reconnect (via `hooks/useNetworkStatus.js`), `app/_layout.jsx` auto-triggers a sync of pending uploads from the SQLite queue. The offline DB (`lib/offlineDb.js`) stores:
- Cached surveys and survey details
- Pending uploads with retry counts
- Sync status tracking

### Backend Connection

Production API and Socket.IO base URLs are in `constants/config.js`. To point at a local backend during development, change the URLs there (commented alternatives exist in the file).

```
API:    https://inspection.claimsmitra.com/api/v1
Socket: https://inspection.claimsmitra.com
```

### Authentication

Token-based auth (access + refresh tokens). The Axios interceptor in `lib/api.js` handles 401 responses by attempting a token refresh before retrying the request. Tokens are stored in AsyncStorage. Role is also stored in AsyncStorage and read at startup to determine routing.

### Path Aliases

`@/` maps to the project root (configured in `babel.config.js` and `jsconfig.json`). Use `@/lib/api` instead of relative paths like `../../lib/api`.
