import { Link } from "react-router"
import LegalShell from "../components/legal/LegalShell"
import Alert from "../components/ui/Alert"
import { useCms } from "../context/CmsContext"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

/**
 * Privacy Policy page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * privacy.eyebrow, privacy.title and privacy.sections (a list of
 * heading+text). When no sections have been saved, the registry defaults
 * render - a Hebrew privacy policy based on the site's actual data practices.
 *
 * IMPORTANT: This page contains PLACEHOLDER content marked with [ריק]
 * where business-specific details must be filled in by the site operator.
 * These placeholders are NOT fabricated facts - they are clearly marked
 * gaps requiring human input before publication.
 */
export default function PrivacyPage() {
  const { settings } = useCms()
  const c = useContent()

  const eyebrow = c("privacy.eyebrow") || "PRIVACY POLICY"
  const title = c("privacy.title") || "מדיניות פרטיות"
  const sections = c.list<{ heading: string; text: string }>("privacy.sections")

  const brandName = settings.brand_name ?? "Casanova"

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
            <Alert tone="warning" title="טיוטה - מסמך זה אינו סופי.">
              סעיפים המסומנים ב־[דרושה השלמה] מחייבים הזנת פרטים אמיתיים על ידי
              בעל האתר. יש לעבור על המסמך עם עורך דין לפני פרסומו. אין לפרסם
              מסמך זה כשהוא מכיל סימוני השלמה.
            </Alert>

            <section>
              <h2>1. מי אנחנו</h2>
              <p>
                האתר <strong>{brandName}</strong> מופעל על ידי [דרושה השלמה - שם
                העסק/החברה המלא, כפי שרשום ברשם העוסקים/חברות].
              </p>
              <p>כתובת: [דרושה השלמה - כתובת פיזית של העסק]</p>
              <p>
                דוא“ל ליצירת קשר בנושאי פרטיות: [דרושה השלמה - כתובת דוא“ל
                ייעודית לנושאי פרטיות]
              </p>
            </section>

            <section>
              <h2>2. איזה מידע אנחנו אוספים</h2>
              <p>
                אנחנו אוספים את המידע הבא, בהתאם לצרכים התפעוליים של השירות:
              </p>
              <ul className="list-disc">
                <li>
                  <strong>כתובת דוא"ל</strong> - לצורך יצירת חשבון, התחברות,
                  שליחת קבלות ואימות זהות.
                </li>
                <li>
                  <strong>שם פרטי ושם משפחה</strong> - לצורך רישום חשבון וביצוע
                  הזמנות.
                </li>
                <li>
                  <strong>מספר טלפון</strong> - נאסף בעת ביצוע רכישה, לצורכי
                  יצירת קשר בנוגע להזמנה. בעת יצירת חשבון בלבד, המספר אופציונלי.
                </li>
                <li>
                  <strong>סיסמה (מוצפנת)</strong> - הסיסמה נשמרת בגיבוב
                  חד-כיווני עם מלח אקראי. אנחנו לא שומרים את הסיסמה עצמה.
                </li>
                <li>
                  <strong>היסטוריית הזמנות ורכישות</strong> - מספרי הזמנה,
                  מוצרים שנרכשו, תאריכים וסכומים.
                </li>
                <li>
                  <strong>התקדמות קריאה</strong> - מעקב אחרי העמוד האחרון שנקרא
                  בכל ספר דיגיטלי.
                </li>
                <li>
                  <strong>פניות תמיכה</strong> - תוכן הפנייה, נושא, והתכתובת עם
                  צוות התמיכה.
                </li>
              </ul>
            </section>

            <section>
              <h2>3. איך אנחנו אוספים את המידע</h2>
              <ul className="list-disc">
                <li>באמצעות טפסי הרשמה והתחברות באתר.</li>
                <li>באמצעות טופס הרכישה (checkout).</li>
                <li>באמצעות טופס יצירת קשר / תמיכה.</li>
                <li>באמצעות התחברות לחשבון הקיים.</li>
              </ul>
            </section>

            <section>
              <h2>4. מטרות איסוף המידע</h2>
              <ul className="list-disc">
                <li>יצירת חשבון משתמש ואימות כתובת דוא"ל.</li>
                <li>ביצוע עסקאות ושליחת קבלות.</li>
                <li>מתן גישה לספרים דיגיטליים שנרכשו.</li>
                <li>מענה לפנייות תמיכה.</li>
                <li>שיפור השירות והחוויה באתר.</li>
              </ul>
            </section>

            <section>
              <h2>5. Cookies ואחסון מקומי</h2>
              <p>
                האתר משתמש ב-<strong>localStorage</strong> של הדפדפן לאחסון:
              </p>
              <ul className="list-disc">
                <li>העדפות נגישות (גודל טקסט, ניגודיות, וכו').</li>
                <li>העדפת ערכת נושא (בהיר/כהה).</li>
                <li>נתוני סשן התחברות (מזהה משתמש).</li>
                <li>מטמון תוכן האתר לטעינה מהירה.</li>
                <li>שמירת intent של רכישה במהלך אימות דוא"ל.</li>
              </ul>
              <p>
                נתונים אלה נשמרים <strong>בדפדפן שלך בלבד</strong> ואינם נשלחים
                לשרת חיצוני. ניתן לנקות אותם בכל עת דרך הגדרות הדפדפן.
              </p>
              <p>
                האתר <strong>אינו משתמש ב-Cookies של צד שלישי</strong> למעט אם
                הופעל שירות Google Analytics (ראו סעיף 7). במצב זה, ייתכן
                שיוטמעו cookies של Google בהתאם למדיניות שלהם.
              </p>
            </section>

            <section>
              <h2>6. שירותי צד שלישי</h2>
              <p>האתר משתמש בשירותי הצד השלישי הבאים:</p>
              <ul className="list-disc">
                <li>
                  <strong>Supabase</strong> - מסד נתונים, אימות משתמשים ואחסון
                  קבצים מאובטח. מידע אישי נשלח לשרתי Supabase.
                </li>
                <li>
                  <strong>Google Fonts</strong> - גופנים נטענים משרתי Google.
                  Google עשוי לקבל את כתובת ה-IP שלך בעת הטעינה.
                </li>
                <li>
                  <strong>Google Analytics</strong> (אופציונלי) - אם הופעל על
                  ידי מנהל האתר, נאסף מידע סטטיסטי אנונימי על ביקורים באתר.
                </li>
              </ul>
              <p>
                אין העברת מידע לגופים מחוץ לישראל מעבר לשירותים המפורטים לעיל.
              </p>
            </section>

            <section>
              <h2>7. Google Analytics</h2>
              <p>
                אם האתר מפעיל Google Analytics, ייתכן שנאסף מידע סטטיסטי כללי על
                ביקורים באתר, כולל כתובת IP מקוצרת, דפים שנצפו ומשך ביקור. מידע
                זה נשלח ל-Google ואינו מזהה אותך אישית.
              </p>
              <p>
                ניתן לבטל את Google Analytics באמצעות תוספי דפדפן כגון
                <a
                  href="https://tools.google.com/dlpage/gaoptout"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {" "}
                  Google Analytics Opt-out
                </a>
                .
              </p>
            </section>

            <section>
              <h2>8. תקופת שמירת מידע</h2>
              <p>
                מידע אישי נשמר כל עוד קיים חשבון פעיל או כנדרש לצורך מילוי חובות
                משפטיות. לאחר מחיקת חשבון, המידע יימחק תוך תקופה סבירה אלא אם
                קיימת חובה משפטית לשמרו לתקופה ארוכה יותר (לדוגמה: חובות דיווח
                לרשויות המס).
              </p>
            </section>

            <section>
              <h2>9. זכויות המשתמש</h2>
              <p>בהתאם לחוק הגנת הפרטיות, התשמ"א-1981, הנך זכאי/ת:</p>
              <ul className="list-disc">
                <li>לעיין במידע האישי שלך המוחזק אצלנו.</li>
                <li>לבקש תיקון או מחיקה של מידע אישי.</li>
                <li>לבקש העתק של המידע האישי שלך.</li>
                <li>להתנגד לעיבוד מידע אישי.</li>
              </ul>
              <p>
                לבקשות אלה, ניתן לפנות אלינו בכתובת: [דרושה השלמה - כתובת דוא“ל
                ליצירת קשר בנושאי פרטיות]
              </p>
            </section>

            <section>
              <h2>10. אבטחת מידע</h2>
              <p>
                אנחנו נוקטים אמצעים סבירים להגנה על המידע האישי שלך, כולל הצפנת
                סיסמאות, שימוש ב-HTTPS, הגבלת גישה לנתונים באמצעות מדיניות אבטחה
                (RLS) ב-Supabase, ומניעת חשיפת מפתחות API בצד הלקוח.
              </p>
              <p>
                עם זאת, אין מערכת מידע שהיא חסינה לחלוטין. במקרה של חשיפת מידע,
                נעדכן את המשתמשים בהקדם האפשרי.
              </p>
            </section>

            <section>
              <h2>11. קטינים</h2>
              <p>
                האתר מיועד לבני 18 ומעלה בלבד. אנחנו לא אוספים מידע אישי מקטינים
                מתחת לגיל 18 ביודעין. אם הנך קטין/ה, אין להשתמש באתר.
              </p>
            </section>

            <section>
              <h2>12. שינויים במדיניות</h2>
              <p>
                אנחנו שומרים לעדכן את מדיניות הפרטיות מעת לעת. שינויים מהותיים
                יפורסמו בעמוד זה עם תאריך עדכון חדש.
              </p>
            </section>

            <section>
              <h2>13. יצירת קשר</h2>
              <p>
                לשאלות בנוגע למדיניות הפרטיות או לזכויותיך, ניתן לפנות אלינו:
              </p>
              <ul className="list-disc">
                <li>
                  באמצעות <Link to="/support">עמוד התמיכה</Link>
                </li>
                <li>בכתובת דוא“ל: [דרושה השלמה - כתובת דוא“ל]</li>
              </ul>
            </section>
          </>
        )}
      </LegalShell>
    </div>
  )
}
