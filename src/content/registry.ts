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
  // page. The id is load-bearing: SalesLandingPage reads its copy through
  // `c("sales.hero.title")` and 49 fields are saved under that prefix in
  // site_content. Renaming the id to "home" would orphan every one of
  // them, so only the label and the path change here.
  { id: "sales", label: "עמוד הבית", path: "/", section: "pages" },
  { id: "store", label: "חנות הספרים", path: "/store", section: "pages" },
  { id: "library", label: "הספרייה שלי", path: "/library", section: "pages" },
  { id: "support", label: "תמיכה", path: "/support", section: "pages" },
  { id: "terms", label: "תנאי שימוש", path: "/terms", section: "legal" },
  { id: "privacy", label: "מדיניות פרטיות", path: "/privacy", section: "legal" },
  { id: "cancellation", label: "ביטול והחזרים", path: "/cancellation-policy", section: "legal" },
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
  area(group, "seo.description", "תיאור בגוגל ובשיתוף (Description)", description, "מומלץ 120–160 תווים.");
  img(group, "seo.image", "תמונת שיתוף (WhatsApp / פייסבוק)", image);
};

const legalSection: ItemField[] = [
  { key: "heading", label: "כותרת הסעיף", type: "text" },
  { key: "text", label: "תוכן", type: "md", hint: "פסקאות מופרדות בשורה ריקה. שורות שמתחילות ב-\"– \" הן רשימה. אפשר להשתמש ב־{{phone}}, {{email}}." },
];

// ── global: navigation, header, footer ───────────────────────────────────────
img("global", "logo", "לוגו האתר", "");
img("global", "favicon", "פאביקון (אייקון בכרטיסיית הדפדפן)", "");
text("global", "brand", "שם המותג", "Casanova");
text("global", "tagline", "שורת תגית", "הספרייה הדיגיטלית שלכם");
list("global", "nav", "תפריט ראשי", [
  { label: "בית", to: "/" },
  { label: "חנות", to: "/store" },
  { label: "הספרייה שלי", to: "/library" },
  { label: "תמיכה", to: "/support" },
], [
  { key: "label", label: "טקסט", type: "text" },
  { key: "to", label: "קישור", type: "link" },
], "label");
text("global", "footerTagline", "משפט בפוטר", "כל הספרים שלכם, במקום אחד.");
text("global", "footerCopyright", "טקסט זכויות יוצרים", "© {year} Casanova. כל הזכויות שמורות.");
seo("global", "Casanova — הספרייה הדיגיטלית שלכם", "ספרים דיגיטליים, מנויים וגישה מיידית — הכל במקום אחד.");

// ── system messages ──────────────────────────────────────────────────────────
text("system", "maintenanceTitle", "כותרת מצב תחזוקה", "כבר חוזרים.");
area("system", "maintenanceText", "טקסט מצב תחזוקה", "אנחנו מבצעים עדכון קצר. אפשר לחזור בעוד כמה דקות.");
text("system", "offline", "הודעת אין חיבור", "אין חיבור לאינטרנט.");
text("system", "notFoundTitle", "כותרת עמוד 404", "העמוד לא נמצא.");
text("system", "notFoundText", "טקסט עמוד 404", "העמוד שחיפשתם לא נמצא או עבר למקום אחר.");
text("system", "notFoundCta", "כפתור 404", "חזרה לבית");

// ── home (landing page) ─────────────────────────────────────────────────────
text("home", "hero.eyebrow", "Hero — שורת פתיחה קטנה", "DIGITAL READING");
rich("home", "hero.title", "Hero — כותרת ראשית", "הספרים שלכם.\n*בכל מקום.*");
area("home", "hero.lede", "Hero — משפט משנה", "ספרייה דיגיטלית עם מאות ספרים, קריאה בכל מכשיר, והמשך קריאה אוטומטי.");
text("home", "hero.cta1", "Hero — כפתור ראשי", "לחנות הספרים");
link("home", "hero.cta1Link", "Hero — קישור כפתור ראשי", "/store");
text("home", "hero.cta2", "Hero — כפתור משני", "איך זה עובד");
link("home", "hero.cta2Link", "Hero — קישור כפתור משני", "#features");
img("home", "hero.image", "Hero — תמונת רקע", "");
text("home", "hero.imageAlt", "Hero — תיאור התמונה (נגישות)", "ספרים דיגיטליים על מסך");
strings("home", "trust", "פס אמון מתחת ל-Hero", ["מאות ספרים", "קריאה אופליין", "כל מכשיר", "מאובטח"]);
text("home", "features.eyebrow", "תכונות — שורה קטנה", "FEATURES");
rich("home", "features.title", "תכונות — כותרת", "למה Casanova.");
list("home", "features.items", "תכונות — אריחים", [
  { title: "ספרייה מלאה", description: "מאות ספרים בקטגוריות שונות, מתעדכט באופן שוטף.", icon: "book" },
  { title: "קריאה בכל מקום", description: "ממשיכים לקרוא מהמכשיר האחרון — טלפון, טאבלט או מחשב.", icon: "devices" },
  { title: "הגנה מתקדמת", description: "הספרים שלכם מוגנים עם DRM ומים אישי.", icon: "shield" },
  { title: "מנויים חודשיים", description: "גישה לכל הספרייה במנוי חודשי, או רכישה חד-פעמית.", icon: "subscription" },
], [
  { key: "title", label: "כותרת", type: "text" },
  { key: "description", label: "תיאור", type: "textarea" },
  { key: "icon", label: "אייקון", type: "text" },
], "title");
text("home", "catalogue.eyebrow", "קטלוג — שורה קטנה", "CATALOGUE");
rich("home", "catalogue.title", "קטלוג — כותרת", "הספרים\n*שלנו.*");
area("home", "catalogue.blurb", "קטלוג — טקסט", "מבחר ספרים דיגיטליים בקטגוריות שונות. עיינו, קנו והתחילו לקרוא מיד.");
text("home", "catalogue.cta", "קטלוג — כפתור", "לכל הספרים");
link("home", "catalogue.ctaLink", "קטלוג — קישור", "/store");
text("home", "pricing.eyebrow", "מחירים — שורה קטנה", "PRICING");
rich("home", "pricing.title", "מחירים — כותרת", "בחרו את המסלול\n*שלכם.*");
area("home", "pricing.blurb", "מחירים — טקסט", "מנוי חודשי לכל הספרייה, או רכישה חד-פעמית של ספרים בודדים.");
seo("home", "Casanova — הספרייה הדיגיטלית שלכם", "ספרים דיגיטליים, מנויים וגישה מיידית — הכל במקום אחד.");

// ── store ────────────────────────────────────────────────────────────────────
text("store", "hero.eyebrow", "Hero — שורה קטנה", "BOOKSTORE");
rich("store", "hero.title", "Hero — כותרת", "חנות הספרים.");
area("store", "hero.lede", "Hero — משפט משנה", "עיינו בקטלוג המלא, קנו ספרים בודדים או הצטרפו למנוי.");
text("store", "empty.title", "חנות ריקה — כותרת", "אין ספרים להצגה");
text("store", "empty.text", "חנות ריקה — טקסט", "חזרו בקרוב, או בדקו קטגוריות אחרות.");
seo("store", "חנות הספרים", "ספרים דיגיטליים — עיינו, קנו והתחילו לקרוא מיד.");

// ── sales landing (היא קודם) ─────────────────────────────────────────────────
text("sales", "hero.eyebrow", "Hero — תווית מותג", "Casanova · מדריך לגבר");
rich("sales", "hero.title", "Hero — כותרת", "היא קודם.\n*ואז אתה כבר לא גבר ממוצע במיטה.*");
area("sales", "hero.lede", "Hero — משפט משנה", "המדריך הפרקטי לגבר שרוצה לדעת מה באמת קורה בגוף שלה, איך להוביל בלי למהר, ואיך לגרום לה לבקש עוד — בלי ניחושים.");
text("sales", "hero.cta", "Hero — כפתור ראשי", "כן. אני רוצה את הספר");
strings("sales", "hero.trust", "Hero — תגי אמון", ["גישה מיידית", "תשלום מאובטח"]);
text("sales", "hero.priceLabel", "Hero — תווית מחיר", "מחיר השקה");
text("sales", "hero.scroll", "Hero — חץ גלילה", "גללו למטה");
text("sales", "audience.yesTitle", "קהל יעד — כותרת חיובי", "למי כן");
text("sales", "audience.noTitle", "קהל יעד — כותרת שלילי", "למי לא");
text("sales", "offer.priceLabel", "הצעה — תווית מחיר", "מחיר השקה");
text("sales", "offer.cta", "הצעה — כפתור", "לקחת את הספר עכשיו");
text("sales", "offer.subtext", "הצעה — טקסט תחת הכפתור", "תשלום מאובטח · הורדה מיידית · אפשר לקרוא הערב");
text("sales", "offer.bonusesLabel", "הצעה — כותרת בונוסים", "בונוסים כלולים");
text("sales", "final.cta", "CTA סופי — כפתור", "כן. אני רוצה את הספר");
text("sales", "header.tagline", "הדר — תגית ליד הלוגו", "· היא קודם");
text("sales", "header.login", "הדר — כפתור התחברות", "לאזור האישי");
text("sales", "footer.copyright", "פוטר — זכויות יוצרים", "© {year} Casanova. כל הזכויות שמורות.");
text("sales", "footer.powered", "פוטר — קרדיט", "Powered by Phantom Third Labs");
text("sales", "exit.dismiss", "פופאפ יציאה — כפתור ביטול", "לא, תודה");
text("sales", "stickyCta", "סרגל נייד — כפתור", "קנייה");

// ── sales: proof strip (B) ──────────────────────────────────────────────────
rich("sales", "proof.title", "Proof — כותרת", 'לא עוד "תחזיק יותר זמן".');
area("sales", "proof.content", "Proof — משפט משנה", "שיטה אחת: היא קודם — והשאר מגיע אחריה.");
list("sales", "proof.items", "Proof — תגי הוכחה", [
  { title: "כתוב לגבר, בלי התנשאות" },
  { title: "עובד בזוגיות ובדייט הראשון" },
], [{ key: "title", label: "טקסט", type: "text" }], "title");

// ── sales: agitation (C) ────────────────────────────────────────────────────
rich("sales", "agitation.title", "Agitation — כותרת", "אתה חושב שהיא נהנתה.\nהיא חושבת על משהו אחר.");
md("sales", "agitation.content", "Agitation — תוכן", 'רוב הגברים מסיימים את הסקס בטוחים שהיה "טוב".\nהאישה מחייכת. לפעמים גם אומרת תודה.\nואז הולכת למקלחת — ואתה לא באמת יודע.\n\nכי למדת סקס ממסך.\nמשם למדת קצב, זווית, ושאורגזמה נשית נראית כמו בסרט.\nבמציאות הגוף שלה מדבר שפה אחרת.\nואם אתה לא קורא אותה — אתה מנגן לבד.\n\nזה לא עניין של גודל.\nזה לא עניין של כמה זמן אתה מחזיק.\nזה עניין של סדר עדיפויות.\n\nכל עוד אתה קודם — היא שנייה.\nואישה שמרגישה שנייה, לא נדלקת עד הסוף.\nגם אם היא נשארת.');

// ── sales: mechanism / method (D) ───────────────────────────────────────────
rich("sales", "mechanism.title", "שיטה — כותרת", "הכלל היחיד שקזנובה אמיתי חי לפיו");
md("sales", "mechanism.content", "שיטה — תוכן", 'קזנובה לא היה האגדה בגלל הכמות.\nהוא היה האגדה כי כל אישה יצאה מהחדר בתחושה שהיא הייתה היחידה בעולם.\n\nזה לא קסם. זו שיטה.\n\nהיא קודם זה לא "תהיה נחמד".\nזה סדר פעולות מדויק:\n\nכשאתה שם אותה קודם, קורה משהו הפוך ממה שגברים מפחדים ממנו:\nאתה לא מוותר על ההנאה שלך.\nאתה מגדיל אותה.\nכי אישה שפורצת — לוקחת אותך איתה.');
list("sales", "mechanism.steps", "שיטה — שלבים", [
  { title: "קודם הקשבה לגוף שלה", content: "לא לפורנו בראש שלך" },
  { title: "קודם חימום נכון", content: "לפני שאתה חושב על חדירה" },
  { title: "קודם העונג שלה", content: "ורק אז השחרור שלך" },
  { title: "קודם נוכחות", content: "לא ביצוע" },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "text" }], "title");

// ── sales: features (E) ─────────────────────────────────────────────────────
rich("sales", "features.title", "פיצ׳רים — כותרת", "מה תדע לעשות אחרי שתקרא את זה פעם אחת");
list("sales", "features.items", "פיצ׳רים — כרטיסים", [
  { title: "המפה שהפורנו מחק", content: 'איפה היא באמת מרגישה, מה מבלבל גברים, ולמה "יותר חזק" כמעט תמיד טעות.' },
  { title: "המשחק המקדים שכבר לא מרגיש כמו חובה", content: "איך להפוך את עשר הדקות שלפני — לחלק שהיא מחכה לו." },
  { title: "הפה, הידיים, הקצב", content: "לא רשימת טריקים. סדר עבודה. מתי לעצור. מתי להעמיק. מתי לשתוק." },
  { title: "איך לא לגמור מוקדם — בלי לספור כבשים", content: "שליטה שבאה מתשומת לב אליה, לא ממלחמה בגוף שלך." },
  { title: "מה היא לא תגיד לך בקול", content: "הסימנים הקטנים: נשימה, אגן, ידיים, שתיקה. לקרוא אותה בלי לחקור אותה." },
  { title: "אחרי", content: "מה עושים אחרי שהאור נדלק. הרגע שבו גבר ממוצע הורס הכל — וגבר שמבין, נועל אותה אליו." },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "textarea" }], "title");

// ── sales: audience (F) ─────────────────────────────────────────────────────
rich("sales", "audience.title", "קהל יעד — כותרת", "למי זה. ולמי לא.");
list("sales", "audience.yes", "קהל יעד — למי כן", [
  { title: "גבר שרוצה להיות טוב באמת." },
  { title: "גבר בזוגיות שמרגיש שהאש ירדה." },
  { title: "גבר שיוצא עם נשים ורוצה להפסיק לנחש." },
  { title: 'גבר שמוכן ללמוד, לא רק "לקבל טיפ אחד מווידאו".' },
], [{ key: "title", label: "טקסט", type: "text" }], "title");
list("sales", "audience.no", "קהל יעד — למי לא", [
  { title: "מי שמחפש קיצור דרך מלוכלך." },
  { title: 'מי שרוצה "לכבוש" בלי לתת.' },
  { title: "מי שחושב שאישה זו מכשיר." },
], [{ key: "title", label: "טקסט", type: "text" }], "title");

// ── sales: brand story (G) ──────────────────────────────────────────────────
rich("sales", "brand.title", "מותג — כותרת", "מי זה Casanova");
md("sales", "brand.content", "מותג — תוכן", "קזנובה נשאר שם נרדף למאהב — כי הוא הבין משהו שרוב הגברים מפספסים עד היום:\nאישה לא זוכרת כמה היית מהיר.\nהיא זוכרת איך הרגשת אותה.\n\nהיא קודם לוקח את העיקרון הזה ומוריד אותו לרצפה.\nבלי אגדות. בלי לטינית. עם הוראות לגבר ישראלי ב-2026.");

// ── sales: social proof / testimonials (H) ──────────────────────────────────
rich("sales", "social.title", "המלצות — כותרת", "מה קורה אחרי הקריאה");
area("sales", "social.content", "המלצות — משפט משנה", "נכתב מתוך מאות שיחות עם גברים — ומתוך מה שנשים באמת אומרות כשאין גבר בחדר.");
list("sales", "social.testimonials", "המלצות — ציטוטים", [
  { quote: "חשבתי שאני בסדר. אחרי שבוע היא שאלה אותי מה שיניתי.", name: "א.", title: "בזוגיות 3 שנים" },
  { quote: "פעם ראשונה שהרגשתי שאני מוביל — בלי למהר לסיים.", name: "ד.", title: "רווק, 32" },
  { quote: "קראתי פעם אחת. הלילה הראשון אחר כך היה שונה לגמרי.", name: "מ.", title: "נשוי" },
], [
  { key: "quote", label: "ציטוט", type: "textarea" },
  { key: "name", label: "שם", type: "text" },
  { key: "title", label: "תיאור", type: "text" },
], "name");

// ── sales: offer / pricing (I) ──────────────────────────────────────────────
rich("sales", "offer.title", "הצעה — כותרת", "מחיר השקה");
area("sales", "offer.content", "הצעה — משפט משנה", "פחות מחשבון שתייה בבר. יותר מכל מה שלמדת מפורנו.");
list("sales", "offer.bonuses", "הצעה — בונוסים", [
  { title: "רשימת בדיקה ללילה הראשון אחרי הקריאה", content: "PDF קצר שיוצא יחד עם הספר" },
  { title: "7 טעויות שהורגות את העונג שלה", content: "רשימה ממוקדת שתחסוך לך ניסוי וטעייה" },
], [{ key: "title", label: "כותרת", type: "text" }, { key: "content", label: "תיאור", type: "text" }], "title");

// ── sales: FAQ (K) ──────────────────────────────────────────────────────────
rich("sales", "faq.title", "FAQ — כותרת", "שאלות נפוצות");
list("sales", "faq.items", "FAQ — שאלות ותשובות", [
  { question: "זה מתאים גם אם אני כבר בזוגיות ארוכה?", answer: "כן. במיוחד." },
  { question: "צריך ניסיון קודם?", answer: "לא. צריך רצון להפסיק לנחש." },
  { question: "זה גס / משפיל?", answer: "לא. זה ישיר. יש הבדל." },
  { question: "דיגיטלי או מודפס?", answer: "ספר דיגיטלי — גישה מיידית אחרי הרכישה." },
  { question: "למה 89 ולא חינם באינטרנט?", answer: "כי באינטרנט יש רעש. כאן יש סדר פעולות." },
], [{ key: "question", label: "שאלה", type: "text" }, { key: "answer", label: "תשובה", type: "textarea" }], "question");

// ── sales: final CTA (L) ────────────────────────────────────────────────────
rich("sales", "final.title", "CTA סופי — כותרת", "הלילה הזה יכול להיות כמו תמיד.\nאו שהוא יכול להיות הלילה שבו היא הבינה שאתה לא כמו השאר.");
area("sales", "final.content", "CTA סופי — טקסט", "Casanova · היא קודם · 89 ₪");

// ── sales: exit popup ───────────────────────────────────────────────────────
text("sales", "exit.title", "פופאפ יציאה — כותרת", "רגע.");
area("sales", "exit.body", "פופאפ יציאה — טקסט", "89 ₪ ואתה יודע מה לעשות הלילה.");
text("sales", "exit.cta", "פופאפ יציאה — כפתור", "כן, אני לוקח");

seo("sales", "Casanova · היא קודם — המדריך לגבר", "המדריך הפרקטי לגבר שרוצה לדעת מה באמת קורה בגוף שלה, איך להוביל בלי למהר, ואיך לגרום לה לבקש עוד.");

// ── library ──────────────────────────────────────────────────────────────────
text("library", "title", "כותרת הספרייה", "הספרייה שלי");
text("library", "empty.title", "ספרייה ריקה — כותרת", "הספרייה שלכם ריקה");
text("library", "empty.text", "ספרייה ריקה — טקסט", "רכשו ספרים מהחנות והם יופיעו כאן.");
text("library", "empty.cta", "ספרייה ריקה — כפתור", "לחנות הספרים");
seo("library", "הספרייה שלי", "הספרים שרכשתם — קראו מכל מכשיר.");

// ── reader ───────────────────────────────────────────────────────────────────
text("reader", "loading", "טעינת קורא", "טוען את הספר…");
text("reader", "errorTitle", "שגיאת קריאה — כותרת", "לא ניתן לטעון את הספר");
text("reader", "errorText", "שגיאת קריאה — טקסט", "בדקו את חיבור האינטרנט ונסו שוב.");

// ── support ──────────────────────────────────────────────────────────────────
text("support", "hero.eyebrow", "Hero — שורה קטנה", "SUPPORT");
rich("support", "hero.title", "Hero — כותרת", "איך נוכל\n*לעזור?*");
area("support", "hero.lede", "Hero — משפט משנה", "שאלה, בעיה או בקשה? אנחנו כאן.");
text("support", "success.title", "הודעת הצלחה — כותרת", "הפנייה נשלחה");
text("support", "success.text", "הודעת הצלחה — טקסט", "נחזור אליכם בהקדם.");
seo("support", "תמיכה", "שאלה? בעיה? אנחנו כאן לעזור.");

// ── legal & accessibility ────────────────────────────────────────────────────
const CONTACT = "לפניות: {{email}}.";
const legal = (group: string, eyebrow: string, title: string, description: string, sections: { heading: string; text: string }[]) => {
  text(group, "eyebrow", "שורה קטנה", eyebrow);
  text(group, "title", "כותרת", title);
  list(group, "sections", "סעיפים", sections, legalSection, "heading", "העריכה כאן משנה את האתר מיד לאחר שמירה.");
  seo(group, title, description);
};

legal("terms", "TERMS OF USE", "תנאי שימוש", "תנאי השימוש באתר Casanova.", [
  { heading: "מפעיל האתר", text: "האתר מופעל על ידי Casanova. " + CONTACT },
  { heading: "מהות השירות", text: "האתר מאפשר רכישת וקריאת ספרים דיגיטליים. רכישת ספר מעניקה הרשאת קריאה אישית שאינה בלעדית." },
  { heading: "חשבונות משתמשים", text: "אתם אחראים לשמור על סודיות פרטי ההתחברות ולעדכן פרטים נכונים." },
  { heading: "הגבלות שימוש", text: "אסור לשתף, להפיץ או להעתיק ספרים שנרכשו. הרשאת הקריאה היא אישית בלבד." },
  { heading: "ביטולים והחזרים", text: "מדיניות הביטול וההחזרים מפורטת ב[עמוד ייעודי](/cancellation-policy)." },
  { heading: "קניין רוחני", text: "התכנים והספרים באתר מוגנים בזכויות יוצרים. אין להעתיק או להפיץ אותם ללא אישור בכתב." },
  { heading: "דין וסמכות שיפוט", text: "על תנאים אלה יחול הדין הישראלי." },
  { heading: "יצירת קשר", text: CONTACT },
]);

legal("privacy", "PRIVACY", "מדיניות פרטיות", "איזה מידע Casanova אוספת ולמה.", [
  { heading: "עקרון מנחה", text: "אנחנו אוספים רק מה שנדרש כדי לאפשר את השירות." },
  { heading: "איזה מידע נאסף", text: "- פרטי חשבון: שם, אימייל וסיסמה (מוצפנת).\n- פרטי רכישה: היסטוריית הזמנות וספרים שנרכשו.\n- נתוני שימוש: התקדמות קריאה ומכשירים מחוברים." },
  { heading: "למה המידע נאסף", text: "- הפעלת חשבון ואספקת ספרים.\n- עיבוד תשלומים.\n- שיפור השירות." },
  { heading: "הזכויות שלכם", text: "בהתאם לחוק הגנת הפרטיות, אתם רשאים לבקש לעיין במידע, לתקן או למחוק." },
  { heading: "יצירת קשר", text: CONTACT },
]);

legal("cancellation", "CANCELLATION", "מדיניות ביטול והחזרים", "איך מבטלים רכישה.", [
  { heading: "ביטול רכישה", text: "ניתן לבקש ביטול רכישה תוך 14 יום ממועד הרכישה, כל עוד לא נעשתה קריאה משמעותית בספר." },
  { heading: "זכות ביטול", text: "בהתאם לחוק הגנת הצרכן." },
  { heading: "החזרים", text: "החזר כספי יבוצע לאמצעי התשלום המקורי תוך 7 ימי עסקים." },
]);

// ── interface microcopy ──────────────────────────────────────────────────────
for (const g of UI_GROUPS) GROUPS.push({ id: g.id, label: g.label.replace("טקסטי ממשק — ", ""), section: "ui" });
for (const [name, [label, def]] of Object.entries(UI)) {
  const g = UI_GROUPS.find((x) => name.startsWith(x.prefix))!;
  add({ group: g.id, key: `ui.${name}`, label, type: "text", default: def, hint: /\{\w+\}/.test(def) || /\{\w+\}/.test(label) ? "אפשר להשאיר את החלקים בסוגריים מסולסלים, כמו {n}: הם מוחלפים אוטומטית." : undefined });
}

// ── lookup helpers ───────────────────────────────────────────────────────────
export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const fieldsOfGroup = (group: string) => FIELDS.filter((f) => f.group === group);

export const PAGE_SEO_GROUPS = GROUPS.filter((g) => FIELD_MAP[`${g.id}.seo.title`]).map((g) => g.id);
