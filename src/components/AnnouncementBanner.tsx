import { SmartLink } from "../content/render"
import { useContent } from "../content/useContent"
import CmsHint from "./CmsHint"
import Icon, { type IconName } from "./icons"

type BannerStyle = "accent" | "warning" | "info"

const STYLE_ICON: Record<BannerStyle, IconName> = {
  accent: "sparkles",
  warning: "alertTriangle",
  info: "zap",
}

/**
 * Live announcement band, driven by the Maestro `announcements` group.
 *
 * Renders above the site header on both public shells, and returns null
 * unless the admin switched it on AND wrote a message - a disabled banner
 * cannot leave an empty strip or a layout gap. The CTA rules degrade the
 * same way: a button label without a link is dropped rather than rendered
 * dead, and a link without a label makes the message itself clickable.
 */
export default function AnnouncementBanner() {
  const c = useContent()

  const enabled = c.bool("announcements.enabled")
  const message = c("announcements.message").trim()
  const href = c("announcements.linkUrl").trim()
  const ctaText = c("announcements.buttonText").trim()
  const rawStyle = c("announcements.bgStyle").trim()
  const style: BannerStyle =
    rawStyle === "warning" || rawStyle === "info" ? rawStyle : "accent"

  if (!enabled) return null

  if (!message)
    return <CmsHint what="הבאנר מופעל אבל ריק - יש להזין טקסט תחת 'באנר והודעות'." />

  return (
    <aside
      className="announcement-banner"
      data-style={style}
      aria-label="הודעת האתר"
    >
      <div className="site-container announcement-banner-inner">
        <span className="announcement-banner-icon" aria-hidden="true">
          <Icon name={STYLE_ICON[style]} size={16} />
        </span>

        {href && ctaText ? (
          <>
            <p className="announcement-banner-text">{message}</p>
            <SmartLink to={href} className="announcement-banner-cta">
              {ctaText}
              <Icon name="arrowLeft" size={12} aria-hidden="true" />
            </SmartLink>
          </>
        ) : href ? (
          <SmartLink to={href} className="announcement-banner-link">
            <span className="announcement-banner-text">{message}</span>
          </SmartLink>
        ) : (
          <p className="announcement-banner-text">{message}</p>
        )}
      </div>
    </aside>
  )
}
