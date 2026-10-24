/**
 * Content registry: EVERY editable piece of the Casanova Bookstore site.
 *
 * - Each field has a stable key, a Hebrew label for Maestro Admin, a type and the default value
 *   the site ships with. Components read values through `useContent()`; Maestro Admin edits them.
 * - A value saved in Maestro (table `site_content`) overrides the default. Deleting it restores the default.
 * - To make something new editable: add a field here, then read it with `c("group.key")` in the component.
 *
 * Text conventions:  *word* = accent (italic / gold),  a newline = line break.
 * Long texts (type "md") support paragraphs, "- " bullets, "## " headings, **bold** and [links](/path).
 */

import { UI, UI_GROUPS } from "./ui";

export type FieldType = "text" | "textarea" | "rich" | "md" | "image" | "link" | "strings" | "list";

export interface ItemField {
  key: string;
  label: string;
  type: "text" | "textarea" | "image" | "link" | "select" | "boolean" | "md";
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  type: FieldType;
  default: unknown;
  hint?: string;
  /** For type "list": the fields of each item, and which one titles the row in the editor. */
  itemFields?: ItemField[];
  itemTitle?: string;
}

export interface GroupDef {
  id: string;
  label: string;
  /** Public URL of the page, used for "open page" and preview. */
  path?: string;
  section: "pages" | "legal" | "global" | "lists" | "ui";
}

export const GROUPS: GroupDef[] = [
  // `/` is served by SalesLandingPage, so the "sales" group IS the main
  // page. The id is load-bearing: its values are saved under that prefix in
  // site_content. Renaming the id would orphan every saved override, so only
  // the label and the path change here.
  { id: "sales", label: "עמוד הבית", path: "/", section: "pages" },
  { id: "store", label: "חנות הספרים", path: "/store", section: "pages" },
  { id: "library", label: "הספרייה שלי", path: "/dashboard/library", section: "pages" },
  { id: "support", label: "תמיכה", path: "/support", section: "pages" },
  { id: "terms", label: "תנאי שימוש", path: "/terms-and-conditions", section: "legal" },
  { id: "privacy", label: "מדיניות פרטיות", path: "/privacy-policy", section: "legal" },
  { id: "cancellation", label: "ביטול והחזרים", path: "/cancellation-and-refund-policy", section: "legal" },
  { id: "global", label: "ניווט, כותרת ופוטר", path: "/", section: "global" },
  { id: "system", label: "הודעות מערכת", section: "global" },
  { id: "lists", label: "רשימות בחירה", section: "lists" },
];

/**
 * The group a super administrator lands on when opening the content
 * editor. Everything else stays reachable in the sidebar, but the
 * landing page is what a storefront owner actually comes here to change.
 */
export const DEFAULT_CONTENT_GROUP = "sales";

export const FIELDS: FieldDef[] = [];

const add = (f: FieldDef) => FIELDS.push(f);
const text = (group: string, key: string, label: string, def: string, hint?: string) => add({ group, key: `${group}.${key}`, label, type: "text", default: def, hint });
const area = (group: string, key: string, label: string, def: string, hint?: string) => add({ group, key: `${group}.${key}`, label, type: "textarea", default: def, hint });
const rich = (group: string, key: string, label: string, def: string) => add({ group, key: `${group}.${key}`, label, type: "rich", default: def, hint: "שורה חדשה = מעבר שורה. *מילה בכוכביות* = הדגשה (איטליק / זהב)." });
const md = (group: string, key: string, label: string, def: string) => add({ group, key: `${group}.${key}`, label, type: "md", default: def });
const img = (group: string, key: string, label: string, def: string) => add({ group, key: `${group}.${key}`, label, type: "image", default: def });
const link = (group: string, key: string, label: string, def: string) => add({ group, key: `${group}.${key}`, label, type: "link", default: def, hint: "כתובת פנימית (/store) או חיצונית (https://…) או עוגן (#features)." });
const strings = (group: string, key: string, label: string, def: string[], hint = "פריט אחד בכל שורה.") => add({ group, key: `${group}.${key}`, label, type: "strings", default: def, hint });
const list = (group: string, key: string, label: string, def: unknown[], itemFields: ItemField[], itemTitle: string, hint?: string) =>
  add({ group, key: `${group}.${key}`, label, type: "list", default: def, itemFields, itemTitle, hint });

/** SEO fields for a page: title, description and social image. */
const seo = (group: string, title: string, description: string, image = "") => {
  text(group, "seo.title", "כותרת בגוגל (Title)", title, "מומלץ עד 60 תווים. שם המותג מתווסף אוטומטית.");
  area(group, "seo.description", "תיאור בגוגל ובשיתוף (Description)", description, "מומלץ 120-160 תווים.");
  img(group, "seo.image", "תמונת שיתוף (WhatsApp / פייסבוק)", image);
};

const legalSection: ItemField[] = [
  { key: "heading", label: "כותרת הסעיף", type: "text" },
  { key: "text", label: "תוכן", type: "md", hint: "פסקאות מופרדות בשורה ריקה. שורות שמתחילות ב-\"- \" הן רשימה. אפשר להשתמש ב־{{phone}}, {{email}}." },
];

// ── global: navigation, header, footer ───────────────────────────────────────
img("global", "logo", "לוגו האתר", "");
img("global", "favicon", "פאביקון (אייקון בכרטיסיית הדפדפן)", "");
text("global", "brand", "שם המותג", "Casanova");
text("global", "tagline", "שורת תגית", "הספרייה הדיגיטלית שלכם");
list("global", "nav", "תפריט ראשי", [
  { label: "הספר", to: "/#about" },
  { label: "חנות", to: "/store" },
  { label: "הספרייה שלי", to: "/dashboard/library" },
  { label: "תמיכה", to: "/support" },
], [
  { key: "label", label: "טקסט", type: "text" },
  { key: "to", label: "קישור", type: "link" },
], "label");
text("global", "footerTagline", "משפט בפוטר", "כל הספרים שלכם, במקום אחד.");
text("global", "footerCopyright", "טקסט זכויות יוצרים", "© {year} Casanova. כל הזכויות שמורות.");
seo("global", "Casanova - הספרייה הדיגיטלית שלכם", "ספרים דיגיטליים, מנויים וגישה מיידית - הכל במקום אחד.");

// ── system messages ──────────────────────────────────────────────────────────
text("system", "maintenanceTitle", "כותרת מצב תחזוקה", "כבר חוזרים.");
area("system", "maintenanceText", "טקסט מצב תחזוקה", "אנחנו מבצעים עדכון קצר. אפשר לחזור בעוד כמה דקות.");
text("system", "offline", "הודעת אין חיבור", "אין חיבור לאינטרנט.");
text("system", "notFoundTitle", "כותרת עמוד 404", "העמוד לא נמצא.");
text("system", "notFoundText", "טקסט עמוד 404", "העמוד שחיפשתם לא נמצא או עבר למקום אחר.");
text("system", "notFoundCta", "כפתור 404", "חזרה לבית");

// ── home (landing page) ─────────────────────────────────────────────────────
text("home", "hero.eyebrow", "Hero - שורת פתיחה קטנה", "DIGITAL READING");
rich("home", "hero.title", "Hero - כותרת ראשית", "הספרים שלכם.\n*בכל מקום.*");
area("home", "hero.lede", "Hero - משפט משנה", "ספרייה דיגיטלית עם מאות ספרים, קריאה בכל מכשיר, והמשך קריאה אוטומטי.");
text("home", "hero.cta1", "Hero - כפתור ראשי", "לחנות הספרים");
link("home", "hero.cta1Link", "Hero - קישור כפתור ראשי", "/store");
text("home", "hero.cta2", "Hero - כפתור משני", "איך זה עובד");
link("home", "hero.cta2Link", "Hero - קישור כפתור משני", "#features");
img("home", "hero.image", "Hero - תמונת רקע", "");
text("home", "hero.imageAlt", "Hero - תיאור התמונה (נגישות)", "ספרים דיגיטליים על מסך");
strings("home", "trust", "פס אמון מתחת ל-Hero", ["מאות ספרים", "קריאה אופליין", "כל מכשיר", "מאובטח"]);
text("home", "features.eyebrow", "תכונות - שורה קטנה", "FEATURES");
rich("home", "features.title", "תכונות - כותרת", "למה Casanova.");
list("home", "features.items", "תכונות - אריחים", [
  { title: "ספרייה מלאה", description: "מאות ספרים בקטגוריות שונות, מתעדכט באופן שוטף.", icon: "book" },
  { title: "קריאה בכל מקום", description: "ממשיכים לקרוא מהמכשיר האחרון - טלפון, טאבלט או מחשב.", icon: "devices" },
  { title: "הגנה מתקדמת", description: "הספרים שלכם מוגנים עם DRM ומים אישי.", icon: "shield" },
  { title: "מנויים חודשיים", description: "גישה לכל הספרייה במנוי חודשי, או רכישה חד-פעמית.", icon: "subscription" },
], [
  { key: "title", label: "כותרת", type: "text" },
  { key: "description", label: "תיאור", type: "textarea" },
  { key: "icon", label: "אייקון", type: "text" },
], "title");
text("home", "catalogue.eyebrow", "קטלוג - שורה קטנה", "CATALOGUE");
rich("home", "catalogue.title", "קטלוג - כותרת", "הספרים\n*שלנו.*");
area("home", "catalogue.blurb", "קטלוג - טקסט", "מבחר ספרים דיגיטליים בקטגוריות שונות. עיינו, קנו והתחילו לקרוא מיד.");
text("home", "catalogue.cta", "קטלוג - כפתור", "לכל הספרים");
link("home", "catalogue.ctaLink", "קטלוג - קישור", "/store");
text("home", "pricing.eyebrow", "מחירים - שורה קטנה", "PRICING");
rich("home", "pricing.title", "מחירים - כותרת", "בחרו את המסלול\n*שלכם.*");
area("home", "pricing.blurb", "מחירים - טקסט", "מנוי חודשי לכל הספרייה, או רכישה חד-פעמית של ספרים בודדים.");
seo("home", "Casanova - הספרייה הדיגיטלית שלכם", "ספרים דיגיטליים, מנויים וגישה מיידית - הכל במקום אחד.");

// ── store ────────────────────────────────────────────────────────────────────
text("store", "hero.eyebrow", "Hero - שורה קטנה", "BOOKSTORE");
rich("store", "hero.title", "Hero - כותרת", "חנות הספרים.");
area("store", "hero.lede", "Hero - משפט משנה", "עיינו בקטלוג המלא, קנו ספרים בודדים או הצטרפו למנוי.");
text("store", "empty.title", "חנות ריקה - כותרת", "אין ספרים להצגה");
text("store", "empty.text", "חנות ריקה - טקסט", "חזרו בקרוב, או בדקו קטגוריות אחרות.");
seo("store", "חנות הספרים", "ספרים דיגיטליים - עיינו, קנו והתחילו לקרוא מיד.");

// ── sales landing (CASANOVA · היא קודם) ─────────────────────────────────────
text("sales", "hero.eyebrow", "Hero - שורת פתיחה", "ספר דיגיטלי · למבוגרים");
rich("sales", "hero.headline", "Hero - כותרת משנה", "הבנה עמוקה יותר של תשוקה, משיכה ואינטימיות");
area("sales", "hero.description", "Hero - פסקת פתיחה", "ספר דיגיטלי לגבר שרוצה להבין מה קורה בגוף שלה, איך להוביל בנוכחות ומתי לעצור - בלי ניחושים.");
text("sales", "hero.buyCta", "Hero - כפתור רכישה", "לרכישת הספר");
text("sales", "hero.secondaryCta", "Hero - כפתור משני", "מה יש בפנים");
link("sales", "hero.secondaryLink", "Hero - קישור לכפתור המשני", "#inside");
strings("sales", "hero.facts", "Hero - עובדות קצרות", ["ספר דיגיטלי", "קריאה בדפדפן", "גישה בחשבון אישי"]);

text("sales", "header.cta", "הדר - כפתור רכישה", "רכישת הספר");
text("sales", "header.login", "הדר - קישור התחברות (לא מחובר)", "התחברות");
text("sales", "header.dashboard", "הדר - קישור לאזור האישי (מחובר)", "האזור שלי");
text("sales", "footer.copyright", "פוטר - זכויות יוצרים", "© {year} CASANOVA. כל הזכויות שמורות.");
text("sales", "footer.powered", "פוטר - קרדיט", "Powered by Phantom Third Labs");
text("sales", "footer.age", "פוטר - הערת גיל", "תוכן למבוגרים · 18+");
text("sales", "stickyCta", "סרגל נייד - כפתור", "לרכישת הספר", "אפשר להשתמש ב־{price}; הוא יוחלף במחיר המוצר העדכני. המחיר מוצג גם לצד הכפתור.");

// ── sales: benefit strip (C) ────────────────────────────────────────────────
list("sales", "benefits.items", "רצועת מידע - פריטים", [
  { title: "ספר דיגיטלי", content: "קריאה בדפדפן, בלי אפליקציה" },
  { title: "ספרייה אישית", content: "הגישה נשמרת בחשבון שלכם" },
  { title: "תוכן למבוגרים", content: "מיועד לבני 18 ומעלה" },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "text" }], "title");

// ── sales: about (D) ───────────────────────────────────────────────────────
text("sales", "about.eyebrow", "על הספר - שורת פתיחה", "על הספר");
rich("sales", "about.title", "על הספר - כותרת", "להעמיק את ההיכרות\n*עם עולם התשוקה.*");
area("sales", "about.body", "על הספר - פסקה ראשונה", "״היא קודם״ הוא מדריך פרקטי לגבר שרוצה להבין מה באמת קורה בגוף שלה - לא לנחש, לא להעמיד פנים, אלא לשים את העונג שלה במרכז ולגלות שההנאה שלו גדלה איתה.");
area("sales", "about.body2", "על הספר - פסקה שנייה", "הספר כתוב בגובה העיניים, בלי התנשאות ובלי הבטחות קסם: סדר פעולות, שפה ברורה והזמנה להתבונן במה שקורה בין שני אנשים.");
text("sales", "about.quote", "על הספר - ציטוט", "אישה לא זוכרת כמה היית מהיר. היא זוכרת איך הרגשת אותה.");
text("sales", "about.quoteCaption", "על הספר - מקור הציטוט", "העיקרון שמאחורי הספר");
list("sales", "about.themes", "על הספר - עקרונות", [
  { title: "הקשבה", content: "לזהות את השפה של הגוף שלה, לא רק את המילים." },
  { title: "נוכחות", content: "להוביל בלי למהר - לדעת מתי להתקרב ומתי לעצור." },
  { title: "תקשורת", content: "לדבר על רצונות בלי מבוכה, לפני ובמהלך." },
  { title: "הרגע שאחרי", content: "לשמור על מה שנבנה גם כשהאור נדלק." },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "textarea" }], "title");

// ── sales: editorial quote (E) ─────────────────────────────────────────────
text("sales", "quote.eyebrow", "ציטוט - שורת פתיחה", "בין השורות");
rich("sales", "quote.text", "ציטוט - טקסט", "זה לא עניין של גודל.\nלא של כמה זמן אתה מחזיק.\n*זה עניין של סדר עדיפויות.*");

// ── sales: preview / table of contents (F) ─────────────────────────────────
text("sales", "inside.eyebrow", "מה בפנים - שורת פתיחה", "מה בפנים");
rich("sales", "inside.title", "מה בפנים - כותרת", "מה תמצאו בספר");
area("sales", "inside.body", "מה בפנים - פסקה", "מבט על הנושאים המרכזיים שבספר. הספר המלא נפתח בספרייה האישית לאחר השלמת הרכישה.");
list("sales", "features.items", "מה בפנים - נושאים", [
  { title: "הקשבה לפני ביצוע", content: "לזהות מה הגוף שלה אומר - בלי לנחש ובלי לשאול בכל רגע." },
  { title: "משחק מקדים כחלק מהמסע", content: "להפוך את הדקות שלפני לרגע שהיא מחכה לו." },
  { title: "מגע, קצב ונוכחות", content: "מתי להתקרב, מתי להעמיק ומתי פשוט להיות שם." },
  { title: "שליטה בלי מלחמה", content: "לא למהר, בלי לספור דקות ובלי להילחם בגוף." },
  { title: "לקרוא אותה נכון", content: "סימנים קטנים של נשימה, אגן וידיים - להבין בלי לחקור." },
  { title: "הרגע שאחרי", content: "מה קורה כשהאור נדלק, ואיך לא להרוס את מה שנבנה." },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "textarea" }], "title");
text("sales", "inside.note", "מה בפנים - הערת תוכן", "זהו מבט על הנושאים המרכזיים, לא קטע מהטקסט. הספר המלא נקרא בספרייה האישית.");
text("sales", "audience.title", "למי זה מתאים - כותרת", "למי זה מתאים");
list("sales", "audience.yes", "למי זה מתאים - פריטים", [
  { title: "למי שרוצה להבין ולא לנחש." },
  { title: "למי שמעדיף שיחה כנה על מין, רצון וקרבה." },
  { title: "למי שמוכן לקרוא, להתבונן ולתרגל - בלי קיצורי דרך." },
], [{ key: "title", label: "טקסט", type: "text" }], "title");

// ── sales: purchase (G) ─────────────────────────────────────────────────────
text("sales", "offer.eyebrow", "רכישה - שורת פתיחה", "רכישה");
rich("sales", "offer.title", "רכישה - כותרת", "הספר שלכם\n*מתחיל כאן.*");
area("sales", "offer.content", "רכישה - פסקה", "״היא קודם״ נפתח בספרייה האישית שלכם לאחר השלמת הרכישה. רכישה חד־פעמית, גישה בחשבון אחד.");
text("sales", "offer.priceLabel", "רכישה - תווית מחיר", "מחיר");
text("sales", "offer.saleLabel", "רכישה - תווית מבצע", "מחיר מוזל");
text("sales", "offer.cta", "רכישה - כפתור", "לרכישת הספר");
text("sales", "offer.subtext", "רכישה - הערה תחת הכפתור", "הרכישה מתבצעת בחשבון משתמש מאומת. הספר אינו נשלח כקובץ במייל.");
strings("sales", "offer.details", "רכישה - פרטי המוצר", ["פורמט: ספר דיגיטלי", "שפה: עברית", "קריאה: בדפדפן, מתוך הספרייה", "גיל: 18+"]);
text("sales", "offer.note", "רכישה - הערת מדיניות", "פרטי הביטול וההחזרים מפורטים בעמוד המדיניות. מומלץ לקרוא לפני הרכישה.");

// ── sales: FAQ (H) ──────────────────────────────────────────────────────────
rich("sales", "faq.title", "FAQ - כותרת", "שאלות נפוצות");
area("sales", "faq.intro", "FAQ - פסקה", "הדברים החשובים לדעת לפני שמתחילים לקרוא.");
list("sales", "faq.items", "FAQ - שאלות ותשובות", [
  { question: "באיזה פורמט מתקבל הספר?", answer: "הספר הוא ספר דיגיטלי. הוא נקרא בדפדפן מתוך הספרייה האישית בחשבון, ואינו נשלח כקובץ במייל." },
  { question: "איך מקבלים גישה לספר?", answer: "לאחר השלמת הרכישה הספר מופיע בספרייה האישית. יש להתחבר עם החשבון שאיתו בוצעה הרכישה. הרכישה מחייבת חשבון משתמש עם כתובת אימייל מאומתת." },
  { question: "באיזו שפה הספר כתוב?", answer: "הספר כתוב בעברית." },
  { question: "באילו מכשירים אפשר לקרוא?", answer: "אפשר לקרוא בדפדפן במחשב, בטאבלט או בטלפון. הקריאה מתבצעת מתוך הספרייה האישית." },
  { question: "למי הספר מיועד?", answer: "הספר מיועד לגברים מגיל 18 ומעלה שמעוניינים להעמיק את ההבנה שלהם בתשוקה, במשיכה ובאינטימיות. הוא אינו מהווה ייעוץ רפואי, טיפולי או זוגי." },
  { question: "מה מדיניות הביטולים?", answer: "מדיניות הביטול וההחזרים מפורטת בעמוד ״ביטול והחזרים״. מומלץ לקרוא אותה לפני הרכישה." },
], [{ key: "question", label: "שאלה", type: "text" }, { key: "answer", label: "תשובה", type: "textarea" }], "question", "אפשר להשתמש ב־{price} והוא יוחלף במחיר המוצר העדכני.");
text("sales", "faq.supportText", "FAQ - טקסט תמיכה", "לא מצאתם תשובה? אפשר לפנות אלינו.");
text("sales", "faq.supportCta", "FAQ - קישור תמיכה", "לעמוד התמיכה");

// ── sales: exit popup ───────────────────────────────────────────────────────
text("sales", "exit.title", "פופאפ יציאה - כותרת", "רגע אחד.");
area("sales", "exit.body", "פופאפ יציאה - טקסט", "לפני שמחליטים, אפשר לראות בקצרה מה יש בספר ואיך מקבלים גישה.");
text("sales", "exit.cta", "פופאפ יציאה - כפתור", "לרכישת הספר");
text("sales", "exit.dismiss", "פופאפ יציאה - כפתור ביטול", "לא עכשיו");

seo(
  "sales",
  "CASANOVA | ספר דיגיטלי על מיניות, משיכה ואינטימיות",
  "הכירו את CASANOVA - המדריך הדיגיטלי ״היא קודם״ על תשוקה, משיכה ואינטימיות. קראו על הספר, הציצו בתוכן ובדקו את פרטי הרכישה.",
  "/covers/hi-kodem-cover-1024.webp",
);

// ── library ──────────────────────────────────────────────────────────────────
text("library", "title", "כותרת הספרייה", "הספרייה שלי");
text("library", "empty.title", "ספרייה ריקה - כותרת", "הספרייה שלכם ריקה");
text("library", "empty.text", "ספרייה ריקה - טקסט", "רכשו ספרים מהחנות והם יופיעו כאן.");
text("library", "empty.cta", "ספרייה ריקה - כפתור", "לחנות הספרים");
seo("library", "הספרייה שלי", "הספרים שרכשתם - קראו מכל מכשיר.");

// ── reader ───────────────────────────────────────────────────────────────────
text("reader", "loading", "טעינת קורא", "טוען את הספר…");
text("reader", "errorTitle", "שגיאת קריאה - כותרת", "לא ניתן לטעון את הספר");
text("reader", "errorText", "שגיאת קריאה - טקסט", "בדקו את חיבור האינטרנט ונסו שוב.");

// ── support ──────────────────────────────────────────────────────────────────
text("support", "hero.eyebrow", "Hero - שורה קטנה", "SUPPORT");
rich("support", "hero.title", "Hero - כותרת", "איך נוכל\n*לעזור?*");
area("support", "hero.lede", "Hero - משפט משנה", "שאלה, בעיה או בקשה? אנחנו כאן.");
text("support", "success.title", "הודעת הצלחה - כותרת", "הפנייה נשלחה");
text("support", "success.text", "הודעת הצלחה - טקסט", "נחזור אליכם בהקדם.");
seo("support", "תמיכה", "שאלה? בעיה? אנחנו כאן לעזור.");

// ── legal & accessibility ────────────────────────────────────────────────────
const CONTACT = "לפניות: [עמוד התמיכה](/support).";
const legal = (group: string, eyebrow: string, title: string, description: string, sections: { heading: string; text: string }[]) => {
  text(group, "eyebrow", "שורה קטנה", eyebrow);
  text(group, "title", "כותרת", title);
  list(group, "sections", "סעיפים", sections, legalSection, "heading", "העריכה כאן משנה את האתר מיד לאחר שמירה.");
  seo(group, title, description);
};

legal("terms", "מידע משפטי", "תנאי שימוש", "תנאי השימוש באתר Casanova.", [
  { heading: "סטטוס", text: "⚠️ טיוטה - מסמך זה טעון השלמת פרטי העסק והגהה משפטית לפני פרסום סופי." },
  { heading: "מפעיל האתר", text: "האתר מופעל על ידי Casanova. " + CONTACT },
  { heading: "מהות השירות", text: "האתר מאפשר רכישת וקריאת ספרים דיגיטליים. רכישת ספר מעניקה הרשאת קריאה אישית שאינה בלעדית." },
  { heading: "חשבונות משתמשים", text: "אתם אחראים לשמור על סודיות פרטי ההתחברות ולעדכן פרטים נכונים." },
  { heading: "הגבלות שימוש", text: "אסור לשתף, להפיץ או להעתיק ספרים שנרכשו. הרשאת הקריאה היא אישית בלבד." },
  { heading: "ביטולים והחזרים", text: "מדיניות הביטול וההחזרים מפורטת ב[עמוד ייעודי](/cancellation-and-refund-policy)." },
  { heading: "קניין רוחני", text: "התכנים והספרים באתר מוגנים בזכויות יוצרים. אין להעתיק או להפיץ אותם ללא אישור בכתב." },
  { heading: "דין וסמכות שיפוט", text: "על תנאים אלה יחול הדין הישראלי." },
  { heading: "יצירת קשר", text: CONTACT },
]);

legal("privacy", "פרטיות", "מדיניות פרטיות", "איזה מידע Casanova אוספת ולמה.", [
  { heading: "סטטוס", text: "⚠️ טיוטה - זהות בעל האתר ותקופות השמירה טעונות השלמה ואישור משפטי לפני פרסום סופי." },
  { heading: "עקרון מנחה", text: "אנחנו אוספים רק מה שנדרש כדי לאפשר את השירות." },
  { heading: "איזה מידע נאסף", text: "- פרטי חשבון: שם, אימייל וסיסמה (נשמרת כהייש, לא כטקסט גלוי).\n- פרטי רכישה: היסטוריית הזמנות וספרים שנרכשו.\n- נתוני שימוש: התקדמות קריאה ומכשירים מחוברים." },
  { heading: "למה המידע נאסף", text: "- הפעלת חשבון ואספקת ספרים.\n- רישום הזמנה והענקת גישה.\n- שיפור השירות." },
  { heading: "איפה המידע נשמר", text: "המידע נשמר אצל ספק האחסון Supabase. חלק מההעדפות נשמרות בדפדפן שלכם (localStorage)." },
  { heading: "הזכויות שלכם", text: "בהתאם לחוק הגנת הפרטיות, אתם רשאים לבקש לעיין במידע, לתקן או למחוק." },
  { heading: "יצירת קשר", text: CONTACT },
]);

legal("cancellation", "רכישה וביטולים", "מדיניות ביטול והחזרים", "איך מבטלים רכישה.", [
  { heading: "סטטוס", text: "⚠️ טיוטה - המדיניות להלן טעונה אימות משפטי לפני פרסום סופי." },
  { heading: "עסקאות מכר מרחוק", text: "בישראל קיימת זכות ביטול לעסקאות מכר מרחוק, ויש לה חריגים. הספר נמכר כ[תוכן דיגיטלי](https://www.gov.il/en/departments/general/consumer_protection_remote_purchasing) המסופק מיידית." },
  { heading: "חריג תוכן דיגיטלי", text: "ייתכן שזכות הביטול חלה על תוכן דיגיטלי שלא נעשה בו שימוש. תחולת החריג על עסקה זו אינה נקבעה כאן וטעונה בדיקת עורך דין." },
  { heading: "איך מבטלים", text: "לבקשת ביטול פנו אלינו דרך [עמוד התמיכה](/support) עם מספר ההזמנה." },
]);

// ── interface microcopy ──────────────────────────────────────────────────────
for (const g of UI_GROUPS) GROUPS.push({ id: g.id, label: g.label.replace("טקסטי ממשק - ", ""), section: "ui" });
for (const [name, [label, def]] of Object.entries(UI)) {
  const g = UI_GROUPS.find((x) => name.startsWith(x.prefix))!;
  add({ group: g.id, key: `ui.${name}`, label, type: "text", default: def, hint: /\{\w+\}/.test(def) || /\{\w+\}/.test(label) ? "אפשר להשאיר את החלקים בסוגריים מסולסלים, כמו {n}: הם מוחלפים אוטומטית." : undefined });
}

// ── lookup helpers ───────────────────────────────────────────────────────────
export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const fieldsOfGroup = (group: string) => FIELDS.filter((f) => f.group === group);

export const PAGE_SEO_GROUPS = GROUPS.filter((g) => FIELD_MAP[`${g.id}.seo.title`]).map((g) => g.id);
