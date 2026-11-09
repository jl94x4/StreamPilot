/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./index.tsx",
    "./client/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-bg) / <alpha-value>)',
        card: 'rgb(var(--color-card) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        plex: 'rgb(var(--color-plex) / <alpha-value>)',       // Orange accent
        // Progress bars: fixed orange, never follows the accent colour.
        progress: 'rgb(var(--color-progress) / <alpha-value>)',
        'plex-hover': 'rgb(var(--color-plex-hover) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        status: {
          active: '#238636',
          expiring: '#d29922',
          expired: '#da3633',
          revoked: '#484f58'
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [
    // TV renders some buttons as role="button" divs (shared/TvButton): disabled: must match those too.
    ({ addVariant }) => { addVariant('disabled', ['&:disabled', '&[aria-disabled="true"]']); },
  ],
}
