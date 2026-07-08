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
        // See DESIGN.md. Legacy names remapped to the violet/slate system;
        // new code should use the semantic names below.
        ink: "#0f172a",
        paper: "#ffffff",
        line: "#e2e8f0",
        brass: "#d97706",
        leaf: "#7c3aed", // deprecated alias of primary
        cream: "#f1f5f9",
        primary: {
          DEFAULT: "#7c3aed",
          hover: "#6d28d9",
          subtle: "#f5f3ff",
          border: "#ddd6fe",
        },
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [typography],
};

export default config;
