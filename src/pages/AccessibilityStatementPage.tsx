import LegalShell from "../components/legal/LegalShell"

/**
 * Accessibility Statement page.
 *
 * Served at /accessibility and /accessibility-statement. Describes the
 * accessibility toolbar and accommodations actually implemented on the
 * site, per Israeli law 5758-1998, Standard 5568 and WCAG 2.1 AA.
 */
export default function AccessibilityStatementPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow="נגישות" title="הצהרת נגישות">
        <div className="mx-auto max-w-3xl text-right">
          <p>
            אתר CASANOVA BOOKS רואה חשיבות עליונה בהבטחת גישה שוויונית,
            מכובדת ונגישה לאנשים עם מוגבלות, בהתאם להוראות חוק שוויון זכויות
            לאנשים עם מוגבלות, התשנ"ח–1998 ותקנותיו, וכן בהתאם לתקן הישראלי
            (ת"י 5568) להנגשת אתרי אינטרנט ברמת AA ובכפוף להנחיות WCAG 2.1.
          </p>

          <p>
            אנו משקיעים מאמצים רבים ומשאבים פיתוח כדי להבטיח שהאתר יהיה נוח,
            ברור ונגיש לכלל הציבור, לרבות אנשים המשתמשים בטכנולוגיות מסייעות.
          </p>

          <section>
            <h2>תפריט נגישות מתקדם באתר</h2>
            <p>
              האתר מצויד בתפריט נגישות ייעודי המאפשר למשתמשים להתאים אישית את
              חוויית הגלישה בהתאם לצרכיהם, וכולל בין היתר:
            </p>
            <ul className="list-disc">
              <li>שליטה בגדלי טקסט (הגדלה והקטנה של פונטים).</li>
              <li>שינוי ניגודיות צבעים (מצבי תצוגה מוגברת וגבוהה).</li>
              <li>אפשרות להפעלת פונט קריא ומותאם.</li>
              <li>הדגשת קישורים באתר לשיפור הניווט.</li>
              <li>
                איפוס הגדרות נגישות ואפשרות להסתרת כפתור הנגישות לפי בחירת
                המשתמש.
              </li>
            </ul>
          </section>

          <section>
            <h2>התאמות טכנולוגיות נוספות</h2>
            <ul className="list-disc">
              <li>
                האתר מותאם לצפייה ולתפעול באמצעות דפדפנים מובילים (כגון Chrome,
                Safari, Firefox, Edge).
              </li>
              <li>האתר תומך בניווט מקלדת באמצעות מקש ה-Tab.</li>
              <li>
                האתר מותאם לתצוגה רספונסיבית במכשירים ניידים ובטאבלטים.
              </li>
            </ul>
          </section>

          <section>
            <h2>פניות, בעיות נגישות ושיפורים</h2>
            <p>
              אנו ממשיכים במאמצים לשפר את נגישות האתר כחלק מחויבותנו לאפשר
              שימוש בו לכלל האוכלוסייה. אם נתקלת בקושי כלשהו בגישה לאתר, או אם
              יש לך הערה או הצעה לשיפור, נשמח אם תפנה אלינו באמצעות רכז הנגישות
              שלנו:
            </p>
            <ul className="list-disc">
              <li>שם/תפקיד: רכז נגישות – Casanova Books</li>
              <li>
                דוא״ל לפניות נגישות:{" "}
                <a
                  dir="ltr"
                  href="mailto:support@casanova-books.com"
                  className="inline-block font-medium text-[var(--color-accent)] underline underline-offset-4 transition-opacity hover:opacity-80"
                >
                  support@casanova-books.com
                </a>
              </li>
            </ul>
            <p>
              על מנת שנוכל טיפול בפנייתך בצורה המיטבית, אנא צרף פנייה מפורטת
              הכוללת:
            </p>
            <ol className="list-decimal">
              <li>תיאור הבעיה או התיאור של הפעולה שלא הצלחת לבצע.</li>
              <li>קישור (URL) לעמוד שבו נתקלת בבעיה.</li>
              <li>סוג הדפדפן ומערכת ההפעלה שבהם השתמשת.</li>
              <li>סוג הטכנולוגיה המסייעת (במידה והשתמשת בה).</li>
            </ol>
            <p>
              אנו נעשה את כל המאמצים כדי לבחון את הפנייה ולתקן את הליקויים
              בהקדם האפשרי.
            </p>
          </section>

          <section>
            <h2>עדכון ההצהרה</h2>
            <p>הצהרת הנגישות עודכנה לאחרונה בחודש נובמבר 2026.</p>
          </section>
        </div>
      </LegalShell>
    </div>
  )
}

