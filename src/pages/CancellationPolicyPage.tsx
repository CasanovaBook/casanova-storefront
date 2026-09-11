import { Link } from "react-router"
import Icon from "../components/icons"

/**
 * Cancellation and Refund Policy page.
 *
 * Displays the website's cancellation and refund policy.
 * Accessible via the /cancellation-and-refund-policy route.
 */
export default function CancellationPolicyPage() {
  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-3xl font-bold mb-4"
            style={{ color: "var(--color-foreground)" }}
          >
            מדיניות ביטול עסקה והחזר כספי
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
            <p>
              מדיניות זו חלה על רכישת הספר הדיגיטלי המשווק תחת המותג CASANOVA BOOKS על ידי [שמו המשפטי של העוסק], עוסק פטור מספר [מספר העוסק], להלן: ״המוכר״.
            </p>
            <div className="space-y-4">
              <h2 className="text-lg font-bold">1. אופי המוצר</h2>
              <p>
                הספר הוא מוצר דיגיטלי המסופק באמצעות קישור אישי, אזור קריאה, הורדה או אמצעי אלקטרוני אחר. מטבעו, ניתן לשמור, להעתיק, לשכפל ולהעביר את תוכנו, ולא ניתן להשיבו למוכר לאחר שניתנה אליו גישה כפי שניתן להשיב מוצר פיזי.
              </p>
              <p>
                מבלי לגרוע מהוראות כל דין, הספר מהווה מידע דיגיטלי, ובשים לב להוראות סעיף 14ג(ד) לחוק הגנת הצרכן, התשמ״א–1981, זכות הביטול הקבועה לעסקת מכר מרחוק אינה חלה ככל שהמוצר נכלל בחריגים הקבועים בדין.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">2. זכות החזר וולונטרית</h2>
              <p>
                לפנים משורת הדין, המוכר מאפשר לרוכש לבקש ביטול וקבלת החזר כספי מלא בתוך 14 ימים קלנדריים ממועד הרכישה, ובלבד שלא בוצעה כל גישה לספר.
              </p>
              <p>
                הזכאות להחזר מותנית בכך שרישומי המערכת יראו כי הספר לא נפתח, לא נצפה, לא הורד ולא נשמר וכי לא נעשה שימוש בקישור או באזור הקריאה שנמסרו לרוכש.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">3. מה ייחשב לשימוש בספר</h2>
              <p>כל אחד מהמקרים הבאים ייחשב למימוש הגישה למוצר:</p>
              <ul className="list-disc list-inside space-y-1 pr-4">
                <li>פתיחת קישור הגישה האישי;</li>
                <li>צפייה בספר או בחלק ממנו;</li>
                <li>הורדת הקובץ או ניסיון להורידו;</li>
                <li>שמירת הקובץ במכשיר או בענן;</li>
                <li>כניסה לאזור הקריאה שבו מוצג הספר;</li>
                <li>כל אינדיקציה טכנית אחרת המעידה על קבלת גישה לתוכן.</li>
              </ul>
              <p>
                מרגע שנרשמה גישה כאמור, לא ניתן יהיה לבטל את העסקה או לקבל החזר בשל חרטה, משום שהתוכן הדיגיטלי כבר הועמד לרשות הרוכש וניתן לשכפול ולהעתקה.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">4. תקלה, אי־אספקה או אי־התאמה</h2>
              <p>
                האמור לעיל אינו גורע מזכות הרוכש במקרה שבו הספר לא סופק, הקישור אינו תקין, הקובץ פגום, בוצע חיוב כפול או התקבל מוצר השונה מהותית מהמוצר שהוצג בעת הרכישה.
              </p>
              <p>
                במקרה כזה יש לפנות למוכר, אשר יהיה רשאי לתקן את התקלה, לספק קישור חלופי או לבצע החזר כספי, בהתאם לנסיבות ולהוראות הדין.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">5. הגשת בקשת ביטול</h2>
              <p>בקשת ביטול תישלח בכתב לכתובת: [כתובת הדוא״ל לשירות לקוחות].</p>
              <p>הבקשה תכלול:</p>
              <ul className="list-disc list-inside space-y-1 pr-4">
                <li>שם מלא;</li>
                <li>כתובת הדוא״ל שבאמצעותה בוצעה הרכישה;</li>
                <li>תאריך הרכישה;</li>
                <li>מספר העסקה;</li>
                <li>סיבת הבקשה.</li>
              </ul>
              <p>
                בקשה העומדת בתנאים תאושר בכתב, וההחזר יבוצע לאמצעי התשלום המקורי בתוך 14 ימים. מועד הופעת הזיכוי בפועל עשוי להשתנות בהתאם לחברת האשראי או לספק התשלום.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">6. רישומי גישה</h2>
              <p>
                לצורך בחינת הזכאות להחזר, המערכת עשויה לשמור נתונים טכניים הנוגעים למועד פתיחת הקישור, הצפייה או הורדת הקובץ, בהתאם למדיניות הפרטיות של האתר. רישומי המערכת ישמשו ראיה לכאורה לעניין מימוש הגישה לספר.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">7. תחולת הדין</h2>
              <p>
                מדיניות זו כפופה לחוקי מדינת ישראל. אין בה כדי לשלול או לצמצם זכות שלא ניתן להתנות עליה על פי דין. במקרה של סתירה בין מדיניות זו לבין הוראת חוק מחייבת, תגבר הוראת החוק.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-bold">8. אזהרה</h2>
              <p>
                כל נסיון לצלם לשכפל ולהעתיק בהנתן הוכחה לכך יגרור נעילה של המשתמש במערכת וחסימה , ללא כל אפשרות לערעור והחזר כספי , אלא אם יתרצה המוכר ויאפשר גישה חוזרת .
              </p>
            </div>
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