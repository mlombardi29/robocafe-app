/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Figtree", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        paper: "#ffffff",
        ink: "#0f172a",
        tide: "#1d4ed8",
        /* Cool neutrals so type and borders stay readable next to the blue, including in glare. */
        stone: {
          50: "#f1f5f9",
          100: "#e2e8f0",
          200: "#cbd5e1",
          300: "#94a3b8",
          400: "#64748b",
          500: "#4f5d6e",
          600: "#3e4c5c",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
    },
  },
  plugins: [],
};
