/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17233d',
        muted: '#74809a',
        line: '#e7eaf2',
        brand: '#6855e8',
        'brand-dark': '#5140ce',
      },
      boxShadow: {
        card: '0 14px 42px rgba(32, 43, 79, 0.07)',
      },
    },
  },
  plugins: [],
};
