import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B132B",
        panel: "#111A33",
        aviation: "#10B981",
      },
    },
  },
  plugins: [],
};

export default config;
