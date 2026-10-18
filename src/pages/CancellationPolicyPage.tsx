import { Link } from "react-router"
import { useContent } from "../content/useContent"
import { Md } from "../content/render"
import Icon from "../components/icons"

/**
 * Cancellation and Refund Policy page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * cancellation.eyebrow, cancellation.title and cancellation.sections.
 */
export default function CancellationPolicyPage() {
  const c = useContent()

  const eyebrow = c("cancellation.eyebrow") || "CANCELLATION"
  const title = c("cancellation.title") || "מדיניות ביטול עסקה והחזר כספי"
  const sections = c.list<{ heading: string; text: string }>("cancellation.sections")

  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
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
          <div className="space-y-6 text-sm leading-relaxed" style={{ color: "var(--color-foreground)" }}>
            {sections.length > 0 ? (
              sections.map((s, i) => (
                <div key={i}>
                  <h2 className="text-lg font-bold mb-2">{s.heading}</h2>
                  <Md text={s.text} className="text-sm leading-relaxed" />
                </div>
              ))
            ) : (
              <>
                <p className="text-xs p-3 rounded-lg mb-6" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-danger)" }}>
                  ⚠️ <strong>טיוטה — מסמך זה אינו סופי.</strong> תוכן זה הינו טיוטה ראשונית בלבד ואינו מהווה ייעוץ משפטי. יש לעבור על המסמך עם עורך דין לפני פרסומו. בפרט, יש לאמת את תחולת חריג הביטול לתוכן דיגיטלי בהתאם לדין.
                </p>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">1. זכות ביטול כללית</h2>
                  <p>בהתאם לחוק הגנת הצרכן, התשמ“א-1981, ולתקנות הגנת הצרכן (ביטול עסקה), התשע“ג-2013, הנך רשאי/ת לבטל עסקה שנכרתה מרחוק תוך 14 ימים מיום ביצוע העסקה או מיום קבלת המוצר, לפי המוקדם מביניהם.</p>
                </section>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">2. חריג — תוכן דיגיטלי</h2>
                  <p>
                    יודגש: הספרים הנמכרים באתר הינם <strong>תוכן דיגיטלי</strong> המסופק באופן מיידי לאחר הרכישה.
                    בהתאם לסעיף 14ג(א)(4) לחוק הגנת הצרכן, זכות הביטול <strong>עשויה שלא לחול</strong> על עסקה לאספקת תוכן דיגיטלי אם הביצוע התחיל בהסכמת הצרכן לאחר שניתן לו מידע מלא אודות אובדן זכות הביטול.
                  </p>
                  <p className="mt-2">
                    ברכישה באתר זה, הלקוח מאשר במפורש בעת השלמת הרכישה כי הוא מוותר על זכות הביטול בגין תוכן דיגיטלי שנצפה/נעשה בו שימוש.
                  </p>
                  <p className="mt-2" style={{ color: "var(--color-danger)" }}>
                    <strong>הערה: סעיף זה טעון אימות משפטי.</strong> התנאים לחריג זה מצטברים, ויש לוודא שהם מתקיימים במקרה הספציפי של עסקה זו.
                  </p>
                </section>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">3. מקרים בהם הביטול כן יחול</h2>
                  <p>גם אם חל חריג הביטול, ביטול יתאפשר במקרים הבאים:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>המוצר פגום או אינו תואם את התיאור באתר.</li>
                    <li>המוצר לא סופק כלל.</li>
                    <li>נפלה טעות בפרטי המוצר כפי שהוצג באתר (לדוגמה: מחיר שגוי באופן מהותי).</li>
                  </ul>
                </section>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">4. אופן ביטול</h2>
                  <p>לבקשת ביטול, יש לפנות אלינו דרך <Link to="/support" className="underline" style={{ color: "var(--color-primary)" }}>עמוד התמיכה</Link> או בכתובת דוא“ל: [דרושה השלמה — כתובת דוא“ל]. יש לציין את מספר ההזמנה ואת סיבת הביטול.</p>
                </section>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">5. החזר כספי</h2>
                  <p>במקרה של ביטול מאושר, ההחזר הכספי יבוצע תוך 14 ימים מיום קבלת הבקשה, באמצעי התשלום המקורי שבו בוצעה העסקה.</p>
                </section>

                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-2">6. תקלות טכניות</h2>
                  <p>במקרה של תקלה טכנית המונעת קריאה, אנא פנו אלינו דרך עמוד התמיכה. נשתדל לפתור את הבעיה בהקדם. אם לא ניתן לפתור את התקלה, יינתן החזר כספי מלא.</p>
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
