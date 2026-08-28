# שערי איכות לפרויקט Audiobooks — גרסת מסמך 1.5.0

לפני commit או פרסום חייבים להתקיים כל התנאים הבאים:

1. `node tools/validate-site.mjs` מסתיים בהצלחה.
2. `node tools/build-site.mjs` יוצר `_site/index.html` וקובץ `.nojekyll`.
3. כל קובץ HTML בשורש כולל doctype, שפה, כיוון כתיבה, title ו־viewport.
4. אין תווי Unicode פגומים, כתובות `file://` או נתיבים מקומיים של Windows.
5. `git diff --check` אינו מדווח על שגיאות whitespace.
6. קובץ הבית `index.html` המוגדר ב־`site.config.json` קיים בשורש ונכלל בפרסום.
7. תהליך GitHub Actions בשם `Deploy GitHub Pages` מסתיים בהצלחה לאחר push ל־`main`.
8. כל דף כולל `noindex,nofollow`, ו־`robots.txt` חוסם את כל הסורקים.
9. אין analytics, trackers או קובצי sitemap.
10. ניווט הז׳אנרים הראשיים קיים, וכל 185 הספרים הנוכחיים מסווגים כ־Self-Help בלי להפוך ז׳אנרים עתידיים לתת־נושאים שלו.
11. כל קישור באזור “תקצירים והעמקה” הוא HTTPS ומאומת; YouTube חייב להיות 20 דקות ומעלה ולא `/shorts/`.
12. אין iframe או תוכן צד שלישי מוטמע. היעדר מקור מאומת מוצג במפורש.
