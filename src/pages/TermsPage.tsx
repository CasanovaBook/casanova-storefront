import { Link } from "react-router"
import { useCms } from "../context/CmsContext"
import { useContent } from "../content/useContent"
import { Md } from "../content/render"
import Icon from "../components/icons"

/**
 * Terms and Conditions page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * terms.eyebrow, terms.title and terms.sections (a list of heading+text).
 * When no sections have been saved, the registry defaults render.
 */
export default function TermsPage() {
  const { settings } = useCms()
  const c = useContent()

  const eyebrow = c("terms.eyebrow") || "TERMS OF USE"
  const title = c("terms.title") || "תנאי שימוש"
  const sections = c.list<{ heading: string; text: string }>("terms.sections")

  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-wide mb-2" style={{ color: "var(--color-primary)" }}>
            {eyebrow}
          </p>
          <h1
            className="text-3xl font-bold mb-4"
            style={{ color: "var(--color-foreground)" }}
          >
            {title}
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
              © {new Date().getFullYear()} {settings.brand_name?.toUpperCase() ?? "CASANOVA BOOKS"}
            </p>
            <p
              className="text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              מאת {settings.brand_name ?? "קזנובה"} | מהדורה ראשונה
            </p>
          </div>

          {/* Terms Content — rendered from the CMS sections list */}
          <div
            className="space-y-6 text-sm leading-relaxed"
            style={{ color: "var(--color-foreground)" }}
            dir="rtl"
          >
            {sections.length > 0 ? (
              sections.map((s, i) => (
                <div key={i}>
                  <h2 className="text-base font-bold mb-2">{s.heading}</h2>
                  <Md text={s.text} className="text-sm leading-relaxed" />
                </div>
              ))
            ) : (
              <>
                <p className="text-xs p-3 rounded-lg mb-6" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-danger)" }}>
                  ⚠️ <strong>טיוטה — מסמך זה אינו סופי.</strong> תוכן זה הינו טיוטה ראשונית בלבד ואינו מהווה ייעוץ משפטי. יש לעבור על המסמך עם עורך דין לפני פרסומו.
                </p>

                <section>
                  <h2 className="text-base font-bold mb-2">1. כללי</h2>
                  <p>תנאי שימוש אלה (“התנאים”) חלים על השימוש באתר {settings.brand_name ?? "Casanova"} (“האתר”), המופעל על ידי [דרושה השלמה — שם בעל האתר]. השימוש באתר מהווה הסכמה לתנאים אלה. אם אינך מסכים לתנאים, אין להשתמש באתר.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">2. מהות השירות</h2>
                  <p>האתר משמש כחנות דיגיטלית למכירת ספרים אלקטרוניים (EBOOK) בעברית. לאחר רכישה, הלקוח מקבל גישה מיידית לקריאת הספר דרך קורא מקוון מוגן באתר. הספרים אינם ניתנים להורדה כקבצים.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">3. יצירת חשבון</h2>
                  <p>כדי לבצע רכישה, יש ליצור חשבון עם כתובת דוא“ל מאומתת, שם מלא וסיסמה. מספר טלפון נדרש בעת הרכישה לצורכי יצירת קשר. הגיל המינימלי לשימוש באתר הוא 18.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">4. הזמנה ותשלום</h2>
                  <p>המחירים באתר כוללים מע“מ אלא אם צוין אחרת. התשלום מתבצע דרך [דרושה השלמה — ספק התשלומים]. פרטי כרטיס האשראי אינם נשמרים באתר. אישור העסקה נשלח לדוא“ל לאחר השלמת הרכישה.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">5. אספקת המוצר</h2>
                  <p>לאחר אישור התשלום, הגישה לספר נפתחת מיידית בספרייה הדיגיטלית של הלקוח באתר. הספר נקרא דרך הדפדפן בקורא המקוון של האתר.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">6. קניין רוחני</h2>
                  <p>כל התוכן באתר, לרבות טקסטים, תמונות, עיצוב וסימני מסחר, הינו בבעלות בעל האתר או ברישיון. אין להעתיק, לשכפל, להפיץ או ליצור נגזרות מהתוכן ללא אישור בכתב.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">7. הגבלות שימוש</h2>
                  <p>אין לשתף את פרטי החשבון או את הגישה לספרים עם צד שלישי. אין לנסות לעקוף את מנגנוני ההגנה של הקורא הדיגיטלי. הפרת תנאים אלה עשויה להוביל לסגירת החשבון.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">8. ביטולים והחזרים</h2>
                  <p>ראה את <Link to="/cancellation-and-refund-policy" className="underline" style={{ color: "var(--color-primary)" }}>מדיניות הביטולים וההחזרים</Link>.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">9. פרטיות</h2>
                  <p>ראה את <Link to="/privacy-policy" className="underline" style={{ color: "var(--color-primary)" }}>מדיניות הפרטיות</Link> שלנו, המתארת אילו נתונים נאספים, כיצד הם משמשים ומהן זכויותיך.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">10. אחריות</h2>
                  <p>האתר מסופק “ככהו“ (AS IS). בעל האתר אינו אחראי לנזקים עקיפים הנובעים מהשימוש באתר או בתוכן. האחריות הישירה מוגבלת לסכום התשלום ששולם בפועל.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">11. שינויים בתנאים</h2>
                  <p>בעל האתר שומר לעדכן את התנאים מעת לעת. שינויים מהותיים יפורסמו בעמוד זה עם תאריך עדכון.</p>
                </section>

                <section>
                  <h2 className="text-base font-bold mb-2">12. יצירת קשר</h2>
                  <p>לשאלות בנוגע לתנאים: <Link to="/support" className="underline" style={{ color: "var(--color-primary)" }}>עמוד התמיכה</Link>.</p>
                </section>
              </>
            )}
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
            {c("ui.common.back") || "חזרה"}
          </Link>
        </div>
      </div>
    </div>
  )
}
