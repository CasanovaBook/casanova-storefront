import LegalShell from "../components/legal/LegalShell"

/**
 * Accessibility Statement page.
 *
 * Served at /accessibility and /accessibility-statement. Best-effort
 * framing: describes the accessibility toolbar and explicitly disclaims
 * full certification, so the copy cannot be read as an over-claim.
 */
export default function AccessibilityStatementPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow="נגישות" title="הצהרת נגישות">
        <div className="mx-auto max-w-3xl text-right">
          <p>
            אתר CASANOVA BOOKS רואה חשיבות עליונה בהנגשת השירותים הדיגיטליים
            שלו לאנשים עם מוגבלות, מתוך שאיפה לאפשר שוויוניות, מכובדות ונגישות
            מרבית בהתאם להוראות הדין ולעקרונות המקובלים.
          </p>

          <p>
            אנו משקיעים משאבים ומאמצים פיתוח כדי לשפר את חוויית השימוש באתר
            עבור כלל הציבור, לרבות באמצעות הטמעת תפריט נגישות ייעודי ומתקדם.
          </p>

          <section>
            <h2>תפריט נגישות באתר</h2>
            <p>
              האתר כולל רכיב הנגשה המסייע בהתאמת התצוגה והגלישה, הכולל בין
              היתר:
            </p>
            <ul className="list-disc">
              <li>שליטה בגדלי טקסט (הגדלה והקטנה).</li>
              <li>התאמת ניגודיות צבעים (מצבי תצוגה שונים).</li>
              <li>אפשרות להפעלת פונט קריא.</li>
              <li>הדגשת קישורים לצורך שיפור הניווט.</li>
              <li>
                אפשרויות לאיפוס הגדרות והסתרת כפתור הנגישות לפי הצורך.
              </li>
            </ul>
          </section>

          <section>
            <h2>הסתייגות וגבולות אחריות</h2>
            <p>
              יודגש כי למרות מאמצינו להנגיש את כלל דפי האתר והתכנים בו, ייתכן
              שחלקים מסוימים טרם הונגשו במלואם, או שטרם נמצא הפתרון הטכנולוגי
              המתאים. האתר אינו מהווה תעודת בדיקה או אישור עמידה רשמי מטעם גוף
              מוסמך, והשימוש בו ניתן כמות שהוא (As-Is). האתר לא יישא באחריות
              לכל אי-התאמה או קושי טכנולוגי שיתגלו בזמן הגלישה.
            </p>
          </section>

          <section>
            <h2>פניות ודיווח על בעיות נגישות</h2>
            <p>
              אם נתקלת בקושי, בתקלה או בבעיית נגישות כלשהי במהלך הגלישה באתר,
              נשמח לקבל את פנייתך כדי שנוכל לבדוק ולטפל בכך בהקדם האפשרי. ניתן
              לפנות אל רכז הנגישות שלנו:
            </p>
            <ul className="list-disc">
              <li>
                דוא״ל לפניות נגישות:{" "}
                <a
                  dir="ltr"
                  href="mailto:cazanova.books@gmail.com"
                  className="inline-block font-medium text-[var(--color-accent)] underline underline-offset-4 transition-opacity hover:opacity-80"
                >
                  cazanova.books@gmail.com
                </a>
              </li>
            </ul>
            <p>
              על מנת שנוכל לטפל בפנייתך ביעילות, מומלץ לצרף פרטים מלאים:
            </p>
            <ol className="list-decimal">
              <li>תיאור הבעיה או הפעולה שלא הצלחת לבצע.</li>
              <li>קישור מדויק (URL) לעמוד שבו נתקלת בקושי.</li>
              <li>סוג הדפדפן ומערכת ההפעלה שבהם השתמשת.</li>
            </ol>
            <p>
              נוסיף ונפעל לשיפור מתמיד של נגישות האתר בהתאם לאמצעים העומדים
              לרשותנו.
            </p>
          </section>

          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            עדכון אחרון: נובמבר 2026.
          </p>
        </div>
      </LegalShell>
    </div>
  )
}

