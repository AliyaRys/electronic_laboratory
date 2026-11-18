# Third-party notices

## @fortawesome/free-solid-svg-icons

- Пакет: `@fortawesome/free-solid-svg-icons`, закреплена точная версия **7.3.1**
  (exact-пин в `package.json`, без диапазона `^`).
- Используемые экспорты (ТЗ DR50 §2.1): `faEgg` (`product-eggs`), `faFish`
  (`product-fish`), `faWheatAwn` (`product-plant`).
- Лицензия: Font Awesome Free License (Icons: CC BY 4.0; код: MIT). Полный
  текст — https://fontawesome.com/license/free и в пакете
  (`node_modules/@fortawesome/free-solid-svg-icons/LICENSE.txt`).
- В runtime bundle попадают только три сгенерированных определения
  (`frontend/src/shared/ui/product-icons.generated.ts` и сгенерированный блок в
  `components/shell/AppHeader.js`); сам пакет — dev-зависимость для генератора
  `scripts/sync-product-icons.mjs` и тестов, CDN/сеть не используются.
