/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f1216',
        panel: '#161b22',
        'panel-2': '#1a1f26',
        border: '#2a313c',
        'border-2': '#3b4252',
        text: '#d8dee9',
        'text-muted': '#6b7785',
        'text-dim': '#4c566a',
        accent: '#88c0d0',
        'accent-2': '#5e81ac',
        'accent-3': '#81a1c1',
        'success': '#a3be8c',
        'warning': '#ebcb8b',
        'danger': '#bf616a',
        'orange': '#d08770',
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
