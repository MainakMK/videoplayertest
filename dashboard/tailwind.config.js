const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', ...defaultTheme.fontFamily.sans],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        primary: 'rgb(var(--primary-rgb) / <alpha-value>)',
        'primary-dim': 'rgb(var(--primary-dim-rgb) / <alpha-value>)',
        'primary-container': 'rgb(var(--primary-container-rgb) / <alpha-value>)',
        tertiary: 'rgb(var(--tertiary-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        'surface-low': 'rgb(var(--surface-low-rgb) / <alpha-value>)',
        'surface-card': 'rgb(var(--surface-card-rgb) / <alpha-value>)',
        'surface-high': 'rgb(var(--surface-high-rgb) / <alpha-value>)',
        'surface-highest': 'rgb(var(--surface-highest-rgb) / <alpha-value>)',
        'secondary-container': 'rgb(var(--secondary-container-rgb) / <alpha-value>)',
        'outline-var': 'rgb(var(--outline-var-rgb) / <alpha-value>)',
        'on-surface': 'rgb(var(--on-surface-rgb) / <alpha-value>)',
        'on-surface-var': 'rgb(var(--on-surface-var-rgb) / <alpha-value>)',
        error: 'rgb(var(--error-rgb) / <alpha-value>)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
      },
      borderRadius: {
        card: '13px',
        btn: '9px',
        input: '9px',
      },
      width: {
        sidebar: '232px',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.4s ease-out',
      },
      boxShadow: {
        card: '0 1px 4px rgba(0, 0, 0, 0.08), 0 4px 20px rgba(91, 90, 139, 0.1)',
      },
    },
  },
  plugins: [],
};
