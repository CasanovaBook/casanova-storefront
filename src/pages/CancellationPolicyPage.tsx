import { Link } from "react-router"
import LegalShell from "../components/legal/LegalShell"
import Alert from "../components/ui/Alert"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

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
  const sections = c.list<{ heading: string; text: string }>(
    "cancellation.sections",
  )

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
              על המסמך עם עורך דין לפני פרסומו. בפרט, יש לאמת את תחולת חריג
              הביטול לתוכן דיגיטלי בהתאם לדין.
            </Alert>

            <section>
              <h2>1. זכות ביטול כללית</h2>
              <p>
                בהתאם לחוק הגנת הצרכן, התשמ“א-1981, ולתקנות הגנת הצרכן (ביטול
                עסקה), התשע“ג-2013, הנך רשאי/ת לבטל עסקה שנכרתה מרחוק תוך 14
                ימים מיום ביצוע העסקה או מיום קבלת המוצר, לפי המוקדם מביניהם.
              </p>
            </section>

            <section>
              <h2>2. חריג — תוכן דיגיטלי</h2>
              <p>
                יודגש: הספרים הנמכרים באתר הינם <strong>תוכן דיגיטלי</strong>{" "}
                המסופק באופן מיידי לאחר הרכישה. בהתאם לסעיף 14ג(א)(4) לחוק הגנת
                הצרכן, זכות הביטול <strong>עשויה שלא לחול</strong> על עסקה
                לאספקת תוכן דיגיטלי אם הביצוע התחיל בהסכמת הצרכן לאחר שניתן לו
                מידע מלא אודות אובדן זכות הביטול.
              </p>
              <p>
                ברכישה באתר זה, הלקוח מאשר במפורש בעת השלמת הרכישה כי הוא מוותר
                על זכות הביטול בגין תוכן דיגיטלי שנצפה/נעשה בו שימוש.
              </p>
              <p style={{ color: "var(--color-danger)" }}>
                <strong>הערה: סעיף זה טעון אימות משפטי.</strong> התנאים לחריג זה
                מצטברים, ויש לוודא שהם מתקיימים במקרה הספציפי של עסקה זו.
              </p>
            </section>

            <section>
              <h2>3. מקרים בהם הביטול כן יחול</h2>
              <p>גם אם חל חריג הביטול, ביטול יתאפשר במקרים הבאים:</p>
              <ul className="list-disc">
                <li>המוצר פגום או אינו תואם את התיאור באתר.</li>
                <li>המוצר לא סופק כלל.</li>
                <li>
                  נפלה טעות בפרטי המוצר כפי שהוצג באתר (לדוגמה: מחיר שגוי באופן
                  מהותי).
                </li>
              </ul>
            </section>

            <section>
              <h2>4. אופן ביטול</h2>
              <p>
                לבקשת ביטול, יש לפנות אלינו דרך{" "}
                <Link to="/support">עמוד התמיכה</Link> או בכתובת דוא“ל: [דרושה
                השלמה — כתובת דוא“ל]. יש לציין את מספר ההזמנה ואת סיבת הביטול.
              </p>
            </section>

            <section>
              <h2>5. החזר כספי</h2>
              <p>
                במקרה של ביטול מאושר, ההחזר הכספי יבוצע תוך 14 ימים מיום קבלת
                הבקשה, באמצעי התשלום המקורי שבו בוצעה העסקה.
              </p>
            </section>

            <section>
              <h2>6. תקלות טכניות</h2>
              <p>
                במקרה של תקלה טכנית המונעת קריאה, אנא פנו אלינו דרך עמוד התמיכה.
                נשתדל לפתור את הבעיה בהקדם. אם לא ניתן לפתור את התקלה, יינתן
                החזר כספי מלא.
              </p>
            </section>
          </>
        )}
      </LegalShell>
    </div>
  )
}
