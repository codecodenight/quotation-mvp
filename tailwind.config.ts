import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#161616",
        paper: "#f8f6f1",
        line: "#ddd8cc",
        brass: "#a36f2d",
        leaf: "#315b48",
        cream: "#f0ebe0",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(22, 22, 22, 0.08)",
      },
    },
  },
  plugins: [typography],
};

export default config;
