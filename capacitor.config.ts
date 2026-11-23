import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

/**
 * Capacitor wraps the same `dist` the browser gets — no second UI codebase.
 *
 * NOT BUILT OR RUN: this machine has neither Xcode (which needs macOS) nor
 * Android Studio, so nothing here has been compiled, installed or opened on a
 * device or simulator. It is a starting point, not a verified build.
 */
const config: CapacitorConfig = {
  appId: 'app.prizma.calendar',
  appName: 'Prizma',
  webDir: 'dist',
  // Relative asset paths (vite `base: './'`) are what make the same build
  // work from the native file:// origin.
  android: {
    backgroundColor: '#0b0a1a',
  },
  ios: {
    backgroundColor: '#0b0a1a',
    // The calendar grid scrolls; bouncing the whole web view over it reads as
    // the page coming loose.
    scrollEnabled: false,
    contentInset: 'always',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#a78bfa',
    },
    Keyboard: {
      // Without this the editor sheet is hidden behind the keyboard on Android.
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
}

export default config
