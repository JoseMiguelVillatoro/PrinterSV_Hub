/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        navy: { 950: '#060f24', 900: '#0b1b3f', 800: '#12285a', 700: '#1a3672' },
        brand: { 50: '#eef5ff', 100: '#d9e8ff', 500: '#1d6fe8', 600: '#155ccc', 700: '#124aa3' },
        accent: { 400: '#22d3ee', 500: '#06b6d4' },
      },
    },
  },
  plugins: [],
};
