/* ────────────────────────────────────────────────────────────
 * Bundled launch copy for the "היא קודם" sales landing page.
 *
 * This module is the single source of truth for every word a visitor
 * reads on the main page (`/`) when no administrator has written anything
 * in the CMS. It exists because the platform's persistence layer is
 * localStorage — every visitor arrives with an empty database, and a
 * CMS-only page would therefore render blank for them.
 *
 * The CMS can override any slot: when an editor creates an active
 * SALES section of the same type, the page renders the CMS version
 * instead of the bundled one. Clearing the CMS slot reverts to the
 * bundled copy. This keeps the page fully editable from /admin/cms/content-editor
 * while still working for any visitor out of the box.
 *
 * The product below is also a fallback: if the catalogue has no
 * published EBOOK with slug "hya-kvdm", the sales page uses this
 * object for the offer block. Where the local document is the
 * catalogue (Supabase unconfigured) the first CTA click still seeds it
 * so checkout can resolve it. With Supabase configured the catalogue is
 * the database: the bundled row is never written anywhere, and shipping
 * a price or an id the catalogue does not hold would be a second source
 * of truth — checkout reports the missing product instead.
 * ───────────────────────────────────────────────────────────── */

import type { CmsSection, FaqItem, Product, Testimonial } from "../types"

import { uid, nowIso } from "./db"

const at = nowIso()

/** The bundled product — used as the offer's source of truth when the
 *  catalogue is empty, and as a safety net when the real product is
 *  missing visual fields (cover image, short description). */

export const BUNDLED_PRODUCT: Product = {
  product_id: "prd_hi_kodem_bundle",

  name: "היא קודם",

  slug: "hya-kvdm",

  product_type: "EBOOK",

  price: 99,

  sale_price: 89,

  currency: "ILS",

  status: "ACTIVE",

  visibility: "PUBLIC",

  availability: "AVAILABLE",

  inventory: null,

  featured: true,

  position: 1,

  image_url: "/covers/hi-kodem-cover.png",

  short_description:
    "חוויות מחדר המיטות — מדריך פרקטי לגבר שרוצה לדעת מה באמת קורה בגוף שלה.",

  description:
    "היא קודם הוא מדריך פרקטי לגבר שרוצה להפסיק לנחש אם היא נהנתה — ולדעת בדיוק מה לעשות כדי שהיא תבקש עוד.",

  cover_colors: ["#2C1810", "#1A0E0A"],

  content_url: "/books/hi-kodem.pdf",

  created_at: at,

  updated_at: at,
}

/** The section types the sales page owns. Each key is a slot name the
 *  page resolves in order: CMS section first, bundled default second. */

export type SalesSlot = "HERO" | "PROOF_STRIP" | "AGITATION" | "MECHANISM" | "FEATURES" | "AUDIENCE" | "BRAND" | "SOCIAL" | "OFFER" | "FAQ" | "FINAL_CTA"

const i = (
  title: string,
  content: string,
  group?: "PRIMARY" | "SECONDARY",
) => ({
  item_id: uid("it"),

  title,

  content,

  group,
})

export const SALES_DEFAULTS: Record<SalesSlot, CmsSection> = {
  HERO: {
    section_id: uid("sec"),

    type: "HERO",

    page: "SALES",

    title: "היא קודם.\nואז אתה כבר לא גבר ממוצע במיטה.",

    content:
      "המדריך הפרקטי לגבר שרוצה לדעת מה באמת קורה בגוף שלה, איך להוביל בלי למהר, ואיך לגרום לה לבקש עוד — בלי ניחושים.",

    active: true,

    display_order: 1,

    updated_at: at,
  },

  PROOF_STRIP: {
    section_id: uid("sec"),

    type: "TEXT",

    page: "SALES",

    title: 'לא עוד "תחזיק יותר זמן".',

    content: "שיטה אחת: היא קודם — והשאר מגיע אחריה.",

    items: [
      i("כתוב לגבר, בלי התנשאות", ""),

      i("עובד בזוגיות ובדייט הראשון", ""),
    ],

    active: true,

    display_order: 2,

    updated_at: at,
  },

  AGITATION: {
    section_id: uid("sec"),

    type: "TEXT",

    page: "SALES",

    title: "אתה חושב שהיא נהנתה.\nהיא חושבת על משהו אחר.",

    content:
      'רוב הגברים מסיימים את הסקס בטוחים שהיה "טוב".\nהאישה מחייכת. לפעמים גם אומרת תודה.\nואז הולכת למקלחת — ואתה לא באמת יודע.\n\nכי למדת סקס ממסך.\nמשם למדת קצב, זווית, ושאורגזמה נשית נראית כמו בסרט.\nבמציאות הגוף שלה מדבר שפה אחרת.\nואם אתה לא קורא אותה — אתה מנגן לבד.\n\nזה לא עניין של גודל.\nזה לא עניין של כמה זמן אתה מחזיק.\nזה עניין של סדר עדיפויות.\n\nכל עוד אתה קודם — היא שנייה.\nואישה שמרגישה שנייה, לא נדלקת עד הסוף.\nגם אם היא נשארת.',

    active: true,

    display_order: 3,

    updated_at: at,
  },

  MECHANISM: {
    section_id: uid("sec"),

    type: "STEPS",

    page: "SALES",

    title: "הכלל היחיד שקזנובה אמיתי חי לפיו",

    content:
      'קזנובה לא היה האגדה בגלל הכמות.\nהוא היה האגדה כי כל אישה יצאה מהחדר בתחושה שהיא הייתה היחידה בעולם.\n\nזה לא קסם. זו שיטה.\n\nהיא קודם זה לא "תהיה נחמד".\nזה סדר פעולות מדויק:\n\nכשאתה שם אותה קודם, קורה משהו הפוך ממה שגברים מפחדים ממנו:\nאתה לא מוותר על ההנאה שלך.\nאתה מגדיל אותה.\nכי אישה שפורצת — לוקחת אותך איתה.',

    items: [
      i("קודם הקשבה לגוף שלה", "לא לפורנו בראש שלך"),

      i("קודם חימום נכון", "לפני שאתה חושב על חדירה"),

      i("קודם העונג שלה", "ורק אז השחרור שלך"),

      i("קודם נוכחות", "לא ביצוע"),
    ],

    active: true,

    display_order: 4,

    updated_at: at,
  },

  FEATURES: {
    section_id: uid("sec"),

    type: "FEATURES",

    page: "SALES",

    title: "מה תדע לעשות אחרי שתקרא את זה פעם אחת",

    content: "",

    items: [
      i(
        "המפה שהפורנו מחק",

        'איפה היא באמת מרגישה, מה מבלבל גברים, ולמה "יותר חזק" כמעט תמיד טעות.',
      ),

      i(
        "המשחק המקדים שכבר לא מרגיש כמו חובה",

        "איך להפוך את עשר הדקות שלפני — לחלק שהיא מחכה לו.",
      ),

      i(
        "הפה, הידיים, הקצב",
        "לא רשימת טריקים. סדר עבודה. מתי לעצור. מתי להעמיק. מתי לשתוק.",
      ),

      i(
        "איך לא לגמור מוקדם — בלי לספור כבשים",

        "שליטה שבאה מתשומת לב אליה, לא ממלחמה בגוף שלך.",
      ),

      i(
        "מה היא לא תגיד לך בקול",

        "הסימנים הקטנים: נשימה, אגן, ידיים, שתיקה. לקרוא אותה בלי לחקור אותה.",
      ),

      i(
        "אחרי",

        "מה עושים אחרי שהאור נדלק. הרגע שבו גבר ממוצע הורס הכל — וגבר שמבין, נועל אותה אליו.",
      ),
    ],

    active: true,

    display_order: 5,

    updated_at: at,
  },

  AUDIENCE: {
    section_id: uid("sec"),

    type: "AUDIENCE",

    page: "SALES",

    title: "למי זה. ולמי לא.",

    content: "",

    items: [
      i("גבר שרוצה להיות טוב באמת.", "", "PRIMARY"),

      i("גבר בזוגיות שמרגיש שהאש ירדה.", "", "PRIMARY"),

      i("גבר שיוצא עם נשים ורוצה להפסיק לנחש.", "", "PRIMARY"),

      i('גבר שמוכן ללמוד, לא רק "לקבל טיפ אחד מווידאו".', "", "PRIMARY"),

      i("מי שמחפש קיצור דרך מלוכלך.", "", "SECONDARY"),

      i('מי שרוצה "לכבוש" בלי לתת.', "", "SECONDARY"),

      i("מי שחושב שאישה זו מכשיר.", "", "SECONDARY"),
    ],

    active: true,

    display_order: 6,

    updated_at: at,
  },

  BRAND: {
    section_id: uid("sec"),

    type: "TEXT",

    page: "SALES",

    title: "מי זה Casanova",

    content:
      "קזנובה נשאר שם נרדף למאהב — כי הוא הבין משהו שרוב הגברים מפספסים עד היום:\nאישה לא זוכרת כמה היית מהיר.\nהיא זוכרת איך הרגשת אותה.\n\nהיא קודם לוקח את העיקרון הזה ומוריד אותו לרצפה.\nבלי אגדות. בלי לטינית. עם הוראות לגבר ישראלי ב-2026.",

    active: true,

    display_order: 7,

    updated_at: at,
  },

  SOCIAL: {
    section_id: uid("sec"),

    type: "TESTIMONIALS",

    page: "SALES",

    title: "מה קורה אחרי הקריאה",

    content:
      "נכתב מתוך מאות שיחות עם גברים — ומתוך מה שנשים באמת אומרות כשאין גבר בחדר.",

    active: true,

    display_order: 8,

    updated_at: at,
  },

  OFFER: {
    section_id: uid("sec"),

    type: "OFFER",

    page: "SALES",

    title: "מחיר השקה",

    content: "פחות מחשבון שתייה בבר. יותר מכל מה שלמדת מפורנו.",

    items: [
      i("רשימת בדיקה ללילה הראשון אחרי הקריאה", "PDF קצר שיוצא יחד עם הספר"),

      i("7 טעויות שהורגות את העונג שלה", "רשימה ממוקדת שתחסוך לך ניסוי וטעייה"),
    ],

    active: true,

    display_order: 9,

    updated_at: at,
  },

  FAQ: {
    section_id: uid("sec"),

    type: "FAQ",

    page: "SALES",

    title: "שאלות נפוצות",

    content: "",

    active: true,

    display_order: 11,

    updated_at: at,
  },

  FINAL_CTA: {
    section_id: uid("sec"),

    type: "CTA",

    page: "SALES",

    title:
      "הלילה הזה יכול להיות כמו תמיד.\nאו שהוא יכול להיות הלילה שבו היא הבינה שאתה לא כמו השאר.",

    content: "Casanova · היא קודם · 89 ₪",

    active: true,

    display_order: 12,

    updated_at: at,
  },
}

/** Bundled FAQ items — shown when no CMS FAQ items exist for the sales page. */

export const SALES_FAQ_DEFAULTS: FaqItem[] = [
  {
    faq_id: uid("faq"),

    question: "זה מתאים גם אם אני כבר בזוגיות ארוכה?",

    answer: "כן. במיוחד.",

    active: true,

    display_order: 1,
  },

  {
    faq_id: uid("faq"),

    question: "צריך ניסיון קודם?",

    answer: "לא. צריך רצון להפסיק לנחש.",

    active: true,

    display_order: 2,
  },

  {
    faq_id: uid("faq"),

    question: "זה גס / משפיל?",

    answer: "לא. זה ישיר. יש הבדל.",

    active: true,

    display_order: 3,
  },

  {
    faq_id: uid("faq"),

    question: "דיגיטלי או מודפס?",

    answer: "ספר דיגיטלי — גישה מיידית אחרי הרכישה.",

    active: true,

    display_order: 4,
  },

  {
    faq_id: uid("faq"),

    question: "למה 89 ולא חינם באינטרנט?",

    answer: "כי באינטרנט יש רעש. כאן יש סדר פעולות.",

    active: true,

    display_order: 5,
  },
]

/** Bundled testimonials — shown when no CMS testimonials exist for the sales page. */

export const SALES_TESTIMONIAL_DEFAULTS: Testimonial[] = [
  {
    testimonial_id: uid("tes"),

    quote: "חשבתי שאני בסדר. אחרי שבוע היא שאלה אותי מה שיניתי.",

    name: "א.",

    title: "בזוגיות 3 שנים",

    avatar: "א",

    active: true,

    display_order: 1,
  },

  {
    testimonial_id: uid("tes"),

    quote: "פעם ראשונה שהרגשתי שאני מוביל — בלי למהר לסיים.",

    name: "ד.",

    title: "רווק, 32",

    avatar: "ד",

    active: true,

    display_order: 2,
  },

  {
    testimonial_id: uid("tes"),

    quote: "קראתי פעם אחת. הלילה הראשון אחר כך היה שונה לגמרי.",

    name: "מ.",

    title: "נשוי",

    avatar: "מ",

    active: true,

    display_order: 3,
  },
]

/** Bundled conversion copy — used as fallback when settings fields are empty. */

export const SALES_SETTINGS_DEFAULTS = {
  sales_sticky_cta: "לקחת את הספר · 89 ₪",

  sales_exit_title: "רגע.",

  sales_exit_body: "89 ₪ ואתה יודע מה לעשות הלילה.",

  sales_exit_cta: "כן, אני לוקח",
}
