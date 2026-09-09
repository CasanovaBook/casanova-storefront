import { useApp } from "../context/AppContext"

import Icon from "./icons"

export default function ThemeToggle() {
  const { theme, toggleTheme } = useApp()

  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
      aria-label={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
      className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-white/5"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-muted-foreground)",
      }}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
    </button>
  )
}
