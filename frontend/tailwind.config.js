module.exports = {
  content: ["./src/**/*.{js,jsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        mystic: "#FF69B4",
        gold: "#D4AF37",
        cosmos: "#0A0A0F",
        card: "#13111A",
      },
      fontFamily: {
        script: ["'Alex Brush'", "cursive"],
        serif: ["'Playfair Display'", "serif"],
      },
    },
  },
  plugins: [],
};
