/** @type {import('tailwindcss').Config} */

// Palette colours are CSS variables (space-separated RGB channels, defined in
// src/index.css) so a plugin page can switch to a named theme preset by
// redefining them on its own subtree. `<alpha-value>` keeps `bg-bg/95` etc.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        'panel-2': v('panel-2'),
        border: v('border'),
        'border-2': v('border-2'),
        text: v('text'),
        'text-muted': v('text-muted'),
        'text-dim': v('text-dim'),
        accent: v('accent'),
        'accent-2': v('accent-2'),
        'accent-3': v('accent-3'),
        'success': v('success'),
        'warning': v('warning'),
        'danger': v('danger'),
        'orange': v('orange'),
        ws: {
          shinobi: '#5e81ac',
          shinobiapps: '#a3be8c',
          sitesnap: '#d08770',
        },
      },
      fontFamily: {
        mono: ['Consolas', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};
