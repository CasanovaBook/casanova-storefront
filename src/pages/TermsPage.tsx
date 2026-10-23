import { Link } from "react-router"
import LegalShell from "../components/legal/LegalShell"
import Alert from "../components/ui/Alert"
import { useCms } from "../context/CmsContext"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

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
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow={eyebrow} title={title}>
        {sections.length > 0 ? (
          sections.map((s, i) => (
            <section key={i}>
              <h2>{s.heading}</h2>
              <Md text={s.text} />
            </section>
          ))
        ) : (
          <>
            <Alert tone="warning" title="טיוטה — מסמך זה אינו סופי.">
              תוכן זה הינו טיוטה ראשונית בלבד ואינו מהווה ייעוץ משפטי. יש לעבור
              על המסמך עם עורך דין לפני פרסומו.
            </Alert>

            <section>
              <h2>1. כללי</h2>
              <p>
                תנאי שימוש אלה (“התנאים”) חלים על השימוש באתר{" "}
                {settings.brand_name ?? "Casanova"} (“האתר”), המופעל על ידי
                [דרושה השלמה — שם בעל האתר]. השימוש באתר מהווה הסכמה לתנאים אלה.
                אם אינך מסכים לתנאים, אין להשתמש באתר.
              </p>
            </section>

            <section>
              <h2>2. מהות השירות</h2>
              <p>
                האתר משמש כחנות דיגיטלית למכירת ספרים אלקטרוניים (EBOOK) בעברית.
                לאחר רכישה, הלקוח מקבל גישה מיידית לקריאת הספר דרך קורא מקוון
                מוגן באתר. הספרים אינם ניתנים להורדה כקבצים.
              </p>
            </section>

            <section>
              <h2>3. יצירת חשבון</h2>
              <p>
                כדי לבצע רכישה, יש ליצור חשבון עם כתובת דוא“ל מאומתת, שם מלא
                וסיסמה. מספר טלפון נדרש בעת הרכישה לצורכי יצירת קשר. הגיל
                המינימלי לשימוש באתר הוא 18.
              </p>
            </section>

            <section>
              <h2>4. הזמנה ותשלום</h2>
              <p>
                המחירים באתר כוללים מע“מ אלא אם צוין אחרת. התשלום מתבצע דרך
                [דרושה השלמה — ספק התשלומים]. פרטי כרטיס האשראי אינם נשמרים
                באתר. אישור העסקה נשלח לדוא“ל לאחר השלמת הרכישה.
              </p>
            </section>

            <section>
              <h2>5. אספקת המוצר</h2>
              <p>
                לאחר אישור התשלום, הגישה לספר נפתחת מיידית בספרייה הדיגיטלית של
                הלקוח באתר. הספר נקרא דרך הדפדפן בקורא המקוון של האתר.
              </p>
            </section>

            <section>
              <h2>6. קניין רוחני</h2>
              <p>
                כל התוכן באתר, לרבות טקסטים, תמונות, עיצוב וסימני מסחר, הינו
                בבעלות בעל האתר או ברישיון. אין להעתיק, לשכפל, להפיץ או ליצור
                נגזרות מהתוכן ללא אישור בכתב.
              </p>
            </section>

            <section>
              <h2>7. הגבלות שימוש</h2>
              <p>
                אין לשתף את פרטי החשבון או את הגישה לספרים עם צד שלישי. אין
                לנסות לעקוף את מנגנוני ההגנה של הקורא הדיגיטלי. הפרת תנאים אלה
                עשויה להוביל לסגירת החשבון.
              </p>
            </section>

            <section>
              <h2>8. ביטולים והחזרים</h2>
              <p>
                ראה את{" "}
                <Link to="/cancellation-and-refund-policy">
                  מדיניות הביטולים וההחזרים
                </Link>
                .
              </p>
            </section>

            <section>
              <h2>9. פרטיות</h2>
              <p>
                ראה את <Link to="/privacy-policy">מדיניות הפרטיות</Link> שלנו,
                המתארת אילו נתונים נאספים, כיצד הם משמשים ומהן זכויותיך.
              </p>
            </section>

            <section>
              <h2>10. אחריות</h2>
              <p>
                האתר מסופק “ככהו“ (AS IS). בעל האתר אינו אחראי לנזקים עקיפים
                הנובעים מהשימוש באתר או בתוכן. האחריות הישירה מוגבלת לסכום
                התשלום ששולם בפועל.
              </p>
            </section>

            <section>
              <h2>11. שינויים בתנאים</h2>
              <p>
                בעל האתר שומר לעדכן את התנאים מעת לעת. שינויים מהותיים יפורסמו
                בעמוד זה עם תאריך עדכון.
              </p>
            </section>

            <section>
              <h2>12. יצירת קשר</h2>
              <p>
                לשאלות בנוגע לתנאים: <Link to="/support">עמוד התמיכה</Link>.
              </p>
            </section>
          </>
        )}

        <footer
          className="mt-8 border-t pt-5 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-muted-foreground)",
          }}
        >
          <p>
            © {new Date().getFullYear()}{" "}
            {settings.brand_name?.toUpperCase() ?? "CASANOVA BOOKS"}
          </p>
          <p>מאת {settings.brand_name ?? "קזנובה"} | מהדורה ראשונה</p>
        </footer>
      </LegalShell>
    </div>
  )
}
