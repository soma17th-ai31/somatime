import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Joonggon-style design tokens (CSS-var driven for light/dark).
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        // Legacy "accent" triple kept stable for existing call sites
        // (bg-accent, text-accent, bg-accent-muted, text-accent-foreground).
        // We rebind it to Joonggon's primary brand color so the visuals
        // update everywhere without touching every component.
        accent: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          muted: "var(--accent-bg)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
        },
        success: {
          DEFAULT: "var(--success)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        // Legacy "surface" tokens used by older components — point at the
        // new design tokens so visuals stay consistent.
        surface: {
          DEFAULT: "var(--background)",
          muted: "var(--card)",
          border: "var(--border)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "Linear Mono",
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        "surface-edge": "var(--surface-edge)",
      },
    },
  },
  plugins: [],
}

export default config
