import { useApp } from "../context/AppContext"

import Icon from "./icons"

export default function ThemeToggle() {
  const { theme, toggleTheme } = useApp()
  const isDark = theme === "dark"
  const actionLabel = isDark ? "מעבר למצב בהיר" : "מעבר למצב כהה"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="מצב כהה"
      title={actionLabel}
      className="theme-toggle"
      onClick={toggleTheme}
    >
      <span
        className="theme-toggle-icon theme-toggle-icon--sun"
        aria-hidden="true"
      >
        <Icon name="sun" size={17} />
      </span>
      <span
        className="theme-toggle-icon theme-toggle-icon--moon"
        aria-hidden="true"
      >
        <Icon name="moon" size={17} />
      </span>
    </button>
  )
}
