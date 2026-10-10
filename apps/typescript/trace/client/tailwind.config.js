/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#F7F8FA',
        surface: '#FFFFFF',
        brand: {
          DEFAULT: '#155EEF',
          hover: '#175CD3',
          subtle: '#EFF8FF',
          border: '#B2DDFF',
        },
        text: {
          primary: '#111827',
          secondary: '#667085',
          tertiary: '#98A2B3',
        },
        border: {
          custom: '#E4E7EC',
          subtle: '#F2F4F7',
        },
        status: {
          verified: {
            text: '#067647',
            bg: '#ECFDF3',
            border: '#ABEFC6',
          },
          contradicted: {
            text: '#B42318',
            bg: '#FEF3F2',
            border: '#FECDCA',
          },
          unreachable: {
            text: '#667085',
            bg: '#F2F4F7',
            border: '#EAECF0',
          },
          review: {
            text: '#B54708',
            bg: '#FFFAEB',
            border: '#FEDF89',
          },
          pending: {
            text: '#175CD3',
            bg: '#EFF8FF',
            border: '#B2DDFF',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
