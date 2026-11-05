/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Figtree", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        paper: "#f4f1ea",
        ink: "#1c1917",
        tide: "#0f766e",
      },
    },
  },
  plugins: [],
};
