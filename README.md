# Audiobooks

אתר One Page בעברית לאוסף ספרי שמע, המתפרסם אוטומטית באמצעות GitHub Pages ונועד לגישה בקישור ישיר בלבד.

- אתר: https://galsec1999.github.io/audiobooks/
- מאגר: https://github.com/galsec1999/audiobooks
- דף הבית במקור: `modern_self_help_audiobooks_2026.html`

## עבודה מקומית

נדרשת Node.js גרסה 20 ומעלה.

```powershell
node tools/validate-site.mjs
node tools/build-site.mjs
```

לאחר הבנייה אפשר לפתוח את `_site/index.html` או להגיש את `_site` באמצעות שרת HTTP מקומי.

## הוספת דף HTML

1. מוסיפים קובץ `*.html` לשורש הפרויקט.
2. שומרים HTML מלא, UTF-8, עברית ו־RTL, title ו־viewport.
3. מריצים את שתי הפקודות שלעיל.
4. מבצעים commit ודוחפים ל־`main`.

אם הדף החדש צריך להפוך לדף הבית, מעדכנים רק את `homepage` בתוך `site.config.json`.

כל דף חייב לכלול `noindex,nofollow`. אין להוסיף analytics, trackers או sitemap. קובץ `robots.txt` חוסם סורקים, אך אינו מונע מאדם שקיבל את הקישור לפתוח או לשתף אותו.

## פרסום

ה־workflow שב־`.github/workflows/deploy-pages.yml` בודק את כל הדפים, בונה חבילת `_site`, ומפרסם אותה ל־GitHub Pages. אין להוסיף את `_site` ל־Git.
