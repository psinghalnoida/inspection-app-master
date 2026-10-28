# Notification sounds

Place a short (1–3 second) notification chime here named `survey_alert.mp3`.

This file is used for:
- The in-app tone played via `expo-av` when a new survey broadcast arrives while the app is open (`lib/sound.js`)
- The Android notification channel `survey_requests` custom sound (registered in `lib/notifications.js`)
- The iOS push notification sound (sent from the backend as `sound: 'survey_alert'`)

After dropping the file in, run a native rebuild so the asset is bundled:

```
eas build --platform android --profile preview
# or
npx expo run:android
npx expo run:ios
```

Note: Android notification channels lock their sound on first creation. If you change the sound file, bump the channel id (e.g. `survey_requests_v2`) in `lib/notifications.js` and the backend's `firebase.service.js`, otherwise existing installs will keep the old sound.
