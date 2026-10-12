// Every user-facing string for app updates lives here, so the copy can be
// reviewed in one place. Plain words, short sentences, no em dashes.

export const UPDATE_COPY = {
  // Card / banner
  eyebrow: 'Update',
  title: (version: string) => `Pry ${version} is ready`,
  currentVersion: (version: string) => `You have ${version}.`,
  notesLabel: "What's new",
  keepsYourStuff: 'Your models, notebook and settings stay as they are. This updates the app only; the engine stays as is.',
  updateButton: 'Update and restart',
  laterButton: 'Later',
  skipButton: 'Skip this version',
  closeLabel: 'Hide update notice',
  bannerText: (version: string) => `Pry ${version} is available.`,

  // Progress
  downloading: 'Downloading the update',
  downloadProgress: (doneMb: string, totalMb: string | null) =>
    totalMb ? `${doneMb} of ${totalMb} MB` : `${doneMb} MB`,
  stoppingEngine: 'Closing the engine so the update can install',
  installing: 'Installing. Pry will close and open again on the new version.',
  progressLabel: 'Update download progress',

  // Errors
  downloadFailed: "The update didn't download. Pry still works as before.",
  installFailed: "The update didn't install. Pry still works as before.",
  tryAgain: 'Try again',
  dismiss: 'Dismiss',

  // Screen reader
  announceFound: (version: string) => `Pry ${version} is available. Open the update notice to install it.`,

  // Settings
  settingsHeading: 'Updates',
  autoCheckLabel: 'Check for updates when Pry starts',
  autoCheckOn: 'On',
  autoCheckOff: 'Off',
  checkNowButton: 'Check now',
  checking: 'Checking...',
  upToDate: (version: string) => `You're on the newest version, ${version}.`,
  available: (version: string) => `Pry ${version} is available.`,
  showUpdate: 'Show update',
  couldNotReach: "Couldn't reach GitHub. Check your connection and try again.",
  privacyNote: 'Checking contacts github.com and sends nothing but the request itself.',
  skippedNote: (version: string) => `You skipped ${version}.`,
} as const;
