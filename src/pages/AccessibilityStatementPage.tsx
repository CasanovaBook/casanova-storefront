import { Link } from "react-router"
import LegalShell from "../components/legal/LegalShell"
import Alert from "../components/ui/Alert"

/**
 * Accessibility Statement page.
 *
 * Based on the verified accessibility work documented in
 * docs/ACCESSIBILITY.md. Only lists accommodations that have been
 * technically verified. Items marked [דרושה השלמה] require human input.
 *
 * This is NOT a compliance certificate — it is a transparency document.
 * See docs/ACCESSIBILITY.md section 9 for the full list of items
 * requiring human or legal verification.
 */
export default function AccessibilityStatementPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow="נגישות" title="הצהרת נגישות">
        <Alert tone="warning" title="טיוטה — הצהרה זו אינה סופית.">
          טרם עברה בדיקת צד שלישי עם טכנולוגיה מסייעת אמיתית. סעיפים המסומנים
          ב־[דרושה השלמה] מחייבים הזנת פרטים.
        </Alert>

        <section>
          <h2>כללי</h2>
          <p>
            אתר Casanova מחויב לנגישות דיגיטלית ומשקיע מאמצים כדי להנגיש את
            השירות לאנשים עם מוגבלות. הצהרה זו מתארת את צעדי הנגישות שיושמו
            באתר, את המגבלות הידועות ואת דרכי יצירת הקשר בנושא.
          </p>
        </section>

        <section>
          <h2>תקנים</h2>
          <p>האתר מכוון לעמידה בתקנים הבאים:</p>
          <ul className="list-disc">
            <li>תקן ישראלי ת"י 5568 חלק 1 (נגישות שירותי אינטרנט)</li>
            <li>WCAG 2.2 רמה AA</li>
          </ul>
        </section>

        <section>
          <h2>התאמות שיושמו ואומתו</h2>
          <p>
            ההתאמות הבאות נבדקו טכנית (כולל בדיקת axe-core עם 0 violations):
          </p>
          <ul className="list-disc">
            <li>
              <strong>מבנה:</strong> עמוד ראשי אחד (&lt;main&gt;) בכל מסך, קישור
              "דלג לתוכן הראשי", מבנה כותרות היררכי עם h1 אחד בכל מסך.
            </li>
            <li>
              <strong>מקלדת:</strong> כל הפונקציונליות נגישה במקלדת. Alt+A פותח
              את תפריט הנגישות מכל מקום. Escape סוגר חלונות קופצים.
            </li>
            <li>
              <strong>טפסים:</strong> תוויות מקושרות לשדות (htmlFor/id), הודעות
              שגיאה עם role="alert" ו-aria-describedby, אימות חי בעת הקלדה.
            </li>
            <li>
              <strong>תמונות:</strong> תמונות דקורטיביות מסומנות alt="" ריק.
              תמונות משמעותיות נושאות תיאור.
            </li>
            <li>
              <strong>פאנל נגישות:</strong> כפתור צף עם dialog semantics, focus
              trap, ו-aria-pressed לכל toggle.
            </li>
            <li>
              <strong>גודל טקסט:</strong> שינוי גודל הטקסט מ-90% עד 160% דרך
              תפריט הנגישות.
            </li>
            <li>
              <strong>ניגודיות:</strong> מצב ניגודיות גבוהה, שיפור ניגודיות
              טקסט, וגווני אפור.
            </li>
            <li>
              <strong>תנועה:</strong> עצירת אנימציות (מכבד גם את
              prefers-reduced-motion של מערכת ההפעלה).
            </li>
            <li>
              <strong>אזורי לחיצה:</strong> הגדלת כפתורים ואזורי אינטראקציה
              ל-52px לפחות.
            </li>
            <li>
              <strong>RTL:</strong> האתר מוגדר lang="he" dir="rtl" עם תמיכה מלאה
              בעברית.
            </li>
            <li>
              <strong>סימני מיקוד:</strong> מסגרת מיקוד מודגשת דו-צבעית לכל רכיב
              אינטראקטיבי.
            </li>
            <li>
              <strong>קישורים:</strong> אפשרות להדגשת כל הקישורים עם קו תחתי.
            </li>
          </ul>
        </section>

        <section>
          <h2>מגבלות ידועות</h2>
          <p>הפריטים הבאים טרם נבדקו באופן מלא או שיש להם מגבלות:</p>
          <ul className="list-disc">
            <li>
              <strong>טפסי ניהול (Admin):</strong> כ-150 פקדים במסכי הניהול אינם
              מתויגים באופן מלא.
            </li>
            <li>
              <strong>קורא ספרים (Reader):</strong> התוכן עצמו (PDF) אינו נגיש
              לקורא מסך בשל הגנת DRM. רק ממשק הקורא (כפתורים, מיקום) נגיש.
            </li>
            <li>
              <strong>בדיקת קורא מסך:</strong> טרם בוצעה בדיקה עם NVDA או
              VoiceOver על מכשיר אמיתי.
            </li>
            <li>
              <strong>ניגודיות על gradients:</strong> חלק מהטקסטים על רקעי
              gradient נבדקו ידנית ולא אוטומטית.
            </li>
          </ul>
        </section>

        <section>
          <h2>רכיב נגישות</h2>
          <p>
            באתר מותקן רכיב נגישות המאפשר שינוי הגדרות תצוגה, ניגודיות, גודל
            טקסט, ריווח, עצירת אנימציות ועוד. הרכיב נגיש במקלדת באמצעות Alt+A
            מכל עמוד באתר.
          </p>
        </section>

        <section>
          <h2>רכז נגישות</h2>
          <p>[דרושה השלמה — שם רכז הנגישות ופרטי התקשרות]</p>
          <p>
            לפניות בנושאי נגישות ניתן גם לפנות דרך{" "}
            <Link to="/support">עמוד התמיכה</Link>.
          </p>
        </section>

        <section>
          <h2>הערה חשובה</h2>
          <p>
            הצהרה זו אינה מהווה חוות דעת משפטית או אישור עמידה מלאה בדרישות
            הדין. בדיקות הנגישות בוצעו באמצעים טכניים (axe-core, בדיקות קוד)
            ואינן תחליף לבדיקת צד שלישי עם משתמשים בטכנולוגיה מסייעת. מומלץ לבצע
            ביקורת נגישות חיצונית לפני הצהרה על עמידה מלאה בתקן.
          </p>
        </section>
      </LegalShell>
    </div>
  )
}
