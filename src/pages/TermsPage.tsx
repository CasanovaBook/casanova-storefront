import { Link } from "react-router"
import { useCms } from "../context/CmsContext"
import Icon from "../components/icons"

/**
 * Terms and Conditions page.
 *
 * Displays the website's terms and conditions content.
 * Accessible via the /terms-and-conditions route.
 */
export default function TermsPage() {
  const { settings } = useCms()

  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-3xl font-bold mb-4"
            style={{ color: "var(--color-foreground)" }}
          >
            תנאי שימוש
          </h1>
          <div
            className="w-16 h-1 mx-auto rounded-full"
            style={{ background: "var(--color-primary)" }}
          />
        </div>

        {/* Content Card */}
        <div
          className="rounded-2xl border p-8 sm:p-10"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Copyright Header */}
          <div className="text-center mb-8 pb-6 border-b" style={{ borderColor: "var(--color-border)" }}>
            <p
              className="text-lg font-semibold mb-1"
              style={{ color: "var(--color-foreground)" }}
            >
              © 2026 CASANOVA BOOKS
            </p>
            <p
              className="text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              מאת קזנובה | מהדורה ראשונה
            </p>
          </div>

          {/* Terms Content */}
          <div
            className="space-y-6 text-sm leading-relaxed"
            style={{ color: "var(--color-foreground)" }}
            dir="rtl"
          >
            <p>
              <strong>כל הזכויות שמורות.</strong> אין להעתיק, לצלם, לשכפל, לתרגם, להפיץ, להעביר או לפרסם חלק מספר זה, בכל אמצעי ובכל פורמט, ללא אישור מראש ובכתב מבעל הזכויות, למעט שימוש המותר על פי דין. רכישת הספר מקנה לרוכש זכות שימוש אישית בלבד ואינה מקנה זכות להעבירו או להפיצו לאחרים.
            </p>

            <p>
              הספר מיועד לבגירים ולבגירות מעל גיל 18 בלבד. תוכנו נועד להעניק ידע כללי בתחום המיניות ואינו מהווה תחליף לייעוץ רפואי, טיפולי או מקצועי אישי.
            </p>

            <p>
              כל מגע מיני חייב להתקיים מתוך הסכמה חופשית, ברורה ומתמשכת של כל המעורבים. ניתן לשנות דעה או להפסיק בכל שלב. במקרה של כאב, פציעה, דימום, גירוי , חשש לזיהום או אי־נוחות חריגה, יש לעצור ולפנות לאיש מקצוע רפואי מתאים.
            </p>

            <p>
              כל גוף מגיב באופן שונה. אין טכניקה שמבטיחה אורגזמה, השפרצה או תגובה מסוימת. מטרת הספר אינה להציב מבחן ביצועים, אלא ללמד הקשבה, תקשורת והתאמה בזמן אמת.
            </p>

            <p>
              האחריות לבחירת הפעולות וליישומן באופן בטוח, מכבד ובהסכמה מוטלת על הקוראים בלבד.
            </p>
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            <Icon name="arrowRight" size={16} />
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    </div>
  )
}