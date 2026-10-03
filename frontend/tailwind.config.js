/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F5F0E8',
        ink: '#111111',
        neo: {
          yellow: '#FFD43B',
          purple: '#A78BFA',
          green: '#7CFF6B',
          red: '#FF6B6B',
          blue: '#6CB6FF',
        },
      },
      boxShadow: {
        neo: '6px 6px 0 #111111',
        'neo-sm': '4px 4px 0 #111111',
        'neo-lg': '8px 8px 0 #111111',
        'neo-none': '0 0 0 #111111',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
