export default function Spinner({
  label = "טוען…",
}: {
  label?: string
}) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <span className="app-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
